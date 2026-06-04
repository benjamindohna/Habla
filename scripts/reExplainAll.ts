// One-shot: classify + re-generate native_translation for every existing
// vocab row through the current vocabExplain prompt. Use this after a
// change to the explain prompt OR after the schema-level switch to
// word_class anchoring (which is what the most recent refactor needed).
//
// SRS state (stage, last_seen, streaks, rank) is NOT touched — learners
// keep all their progress. Only the translation string is overwritten
// and word_class is filled in. TTS audio is not regenerated either
// (the spoken word doesn't change when the prompt for the translation
// changes).
//
// Sequential with 429-backoff to stay under OpenAI's TPM rate limit on
// lower tiers — gpt-4o explain calls + gpt-4o-mini classify calls
// together push hard against 30k TPM.
//
// Usage:
//   npx tsx scripts/reExplainAll.ts --dry-run   # preview only
//   npx tsx scripts/reExplainAll.ts --confirm   # actually overwrite

import { db } from "../lib/db";
import { userVocab } from "../lib/schema";
import { asc, eq } from "drizzle-orm";
import { generateExplanation } from "../lib/vocabExplain";
import { classifyVocab } from "../lib/vocabClassify";
import { getUserById } from "../lib/users";

interface Row {
  id: number;
  user_id: number;
  target_word_original: string;
  word_class: string | null;
  context_sentence: string | null;
  native_translation: string | null;
}

const CONCURRENCY = 1;
const MAX_429_RETRIES = 6;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(message: string): number {
  const secMatch = /try again in ([\d.]+)s/.exec(message);
  if (secMatch) return Math.ceil(parseFloat(secMatch[1]) * 1000);
  const msMatch = /try again in (\d+)ms/.exec(message);
  if (msMatch) return parseInt(msMatch[1], 10);
  return 3000;
}

async function withBackoff<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("429") && attempt < MAX_429_RETRIES) {
        const waitMs = parseRetryAfterMs(message) + 500;
        console.warn(`  ${label}: 429, sleeping ${waitMs}ms (attempt ${attempt + 1}/${MAX_429_RETRIES})`);
        await sleep(waitMs);
        continue;
      }
      console.warn(`  ${label} failed:`, message);
      return null;
    }
  }
  return null;
}

async function regenerateRow(row: Row): Promise<{ id: number; ok: boolean }> {
  const user = await getUserById(row.user_id);
  if (!user) {
    console.warn(`  row ${row.id}: user ${row.user_id} not found, skipping`);
    return { id: row.id, ok: false };
  }

  // Step 1: classify if word_class is missing. Uses context_sentence —
  // the only place context still matters in the new pipeline.
  let wordClass = row.word_class;
  if (!wordClass) {
    const classified = await withBackoff(`row ${row.id} classify`, () =>
      classifyVocab({
        target_word: row.target_word_original,
        context_sentence: row.context_sentence ?? "",
        targetLanguage: user.targetLanguage,
      }),
    );
    if (!classified) return { id: row.id, ok: false };
    wordClass = classified;
    await db.update(userVocab).set({ wordClass }).where(eq(userVocab.id, row.id));
  }

  // Step 2: regenerate translation through the new prompt.
  const explain = await withBackoff(`row ${row.id} explain`, () =>
    generateExplanation({
      target_word: row.target_word_original,
      word_class: wordClass as never,
      targetLanguage: user.targetLanguage,
      native_language: user.nativeLanguage,
    }),
  );
  if (!explain) return { id: row.id, ok: false };

  await db
    .update(userVocab)
    .set({ nativeTranslation: explain.translation })
    .where(eq(userVocab.id, row.id));
  return { id: row.id, ok: true };
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
      word_class: userVocab.wordClass,
      context_sentence: userVocab.contextSentence,
      native_translation: userVocab.nativeTranslation,
    })
    .from(userVocab)
    .orderBy(asc(userVocab.id));
  const rows = rowsRaw as Row[];

  console.log(
    `Found ${rows.length} rows across ${new Set(rows.map((r) => r.user_id)).size} user(s).`,
  );
  const needClassify = rows.filter((r) => !r.word_class).length;
  console.log(`  ${needClassify} need classify; ${rows.length - needClassify} have word_class already.`);
  if (rows.length === 0) return;

  if (dryRun) {
    console.log("\n--dry-run: no changes will be made.");
    for (const r of rows.slice(0, 10)) {
      console.log(
        `  row ${r.id} user=${r.user_id} word="${r.target_word_original}" ` +
          `class=${r.word_class ?? "(none)"} current="${r.native_translation ?? "(null)"}"`,
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
      `(Re-run to retry failed rows — they'll keep whatever translation was last written.)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
