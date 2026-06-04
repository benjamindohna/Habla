// One-shot: re-generate native_translation + native_hint for EVERY
// existing vocab row through the current vocabExplain prompt. Use this
// after a change to that prompt when existing rows should reflect the
// new behaviour.
//
// SRS state (stage, last_seen, streaks, rank) is NOT touched —
// learners keep all their progress. Only the translation/hint strings
// are overwritten. TTS audio is not regenerated either (the spoken
// word doesn't change when the prompt for the translation changes).
//
// Mechanism: null out native_translation + native_hint for all rows,
// then run the same backfill loop the regular backfill script uses
// (which only touches rows where those fields are null).
//
// Usage:
//   npx tsx scripts/reExplainAll.ts --dry-run   # preview only
//   npx tsx scripts/reExplainAll.ts --confirm   # actually overwrite
//
// Run with the dev server stopped.

import { db } from "../lib/db";
import { userVocab } from "../lib/schema";
import { asc, eq } from "drizzle-orm";
import { generateExplanation } from "../lib/vocabExplain";
import { getUserById } from "../lib/users";

interface Row {
  id: number;
  user_id: number;
  target_word_original: string;
  english_description: string;
  context_sentence: string | null;
  native_translation: string | null;
  native_hint: string | null;
}

// Sequential to keep us under OpenAI's TPM rate limit on lower tiers.
// gpt-4o on tier 1 is 30k TPM; each explain call ~1300 tokens, so
// even one call every ~3 sec is borderline. Concurrency > 1 reliably
// trips 429s on this prompt.
const CONCURRENCY = 1;

// Retry a 429 up to this many times. The API's response includes a
// suggested retry-after; we read it via the error message and back off.
const MAX_429_RETRIES = 6;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse "try again in 2.04s" / "try again in 574ms" from a 429 message. */
function parseRetryAfterMs(message: string): number {
  const secMatch = /try again in ([\d.]+)s/.exec(message);
  if (secMatch) return Math.ceil(parseFloat(secMatch[1]) * 1000);
  const msMatch = /try again in (\d+)ms/.exec(message);
  if (msMatch) return parseInt(msMatch[1], 10);
  return 3000; // sensible default if the format ever changes
}

async function regenerateRow(row: Row): Promise<{ id: number; ok: boolean }> {
  const user = await getUserById(row.user_id);
  if (!user) {
    console.warn(`  row ${row.id}: user ${row.user_id} not found, skipping`);
    return { id: row.id, ok: false };
  }
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    try {
      const res = await generateExplanation({
        target_word: row.target_word_original,
        english_description: row.english_description,
        context_sentence: row.context_sentence ?? "",
        targetLanguage: user.targetLanguage,
        native_language: user.nativeLanguage,
      });
      await db
        .update(userVocab)
        .set({ nativeTranslation: res.translation, nativeHint: res.hint })
        .where(eq(userVocab.id, row.id));
      return { id: row.id, ok: true };
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("429") && attempt < MAX_429_RETRIES) {
        const waitMs = parseRetryAfterMs(message) + 500; // small jitter
        console.warn(`  row ${row.id}: 429, sleeping ${waitMs}ms (attempt ${attempt + 1}/${MAX_429_RETRIES})`);
        await sleep(waitMs);
        continue;
      }
      console.warn(`  row ${row.id} explain failed:`, message);
      return { id: row.id, ok: false };
    }
  }
  return { id: row.id, ok: false };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const confirmed = args.has("--confirm");
  if (!dryRun && !confirmed) {
    console.error("Refusing to run without --dry-run or --confirm. Use --dry-run first.");
    process.exit(1);
  }

  const rowsRaw = await db
    .select({
      id: userVocab.id,
      user_id: userVocab.userId,
      target_word_original: userVocab.targetWordOriginal,
      english_description: userVocab.englishDescription,
      context_sentence: userVocab.contextSentence,
      native_translation: userVocab.nativeTranslation,
      native_hint: userVocab.nativeHint,
    })
    .from(userVocab)
    .orderBy(asc(userVocab.id));
  const rows = rowsRaw as Row[];

  console.log(
    `Found ${rows.length} rows across ${new Set(rows.map((r) => r.user_id)).size} user(s).`,
  );
  if (rows.length === 0) return;

  if (dryRun) {
    console.log("\n--dry-run: no changes will be made.");
    for (const r of rows.slice(0, 10)) {
      console.log(
        `  row ${r.id} user=${r.user_id} word="${r.target_word_original}" ` +
          `current translation="${r.native_translation ?? "(null)"}"`,
      );
    }
    if (rows.length > 10) console.log(`  … (+${rows.length - 10} more)`);
    console.log("\nRun with --confirm to overwrite translations.");
    return;
  }

  console.log(`Regenerating ${rows.length} rows (concurrency ${CONCURRENCY})…`);
  const startMs = Date.now();
  let done = 0;
  let fails = 0;

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(regenerateRow));
    for (const r of results) {
      done++;
      if (!r.ok) fails++;
    }
    console.log(`  ${done}/${rows.length}`);
  }

  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(
    `\n✓ Done. ${done} rows processed in ${elapsedSec}s. Failures: ${fails}. ` +
      `(Re-run to retry failed rows — they'll have whatever translation was last written.)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
