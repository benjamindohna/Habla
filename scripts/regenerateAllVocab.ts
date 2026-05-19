// One-shot: wipe all user_vocab rows and replay each through the
// current description + translation generators. Use after a change to
// the generateVocabDescription prompt when existing rows should reflect
// the new behaviour.
//
// Replay preserves only (user_id, target_word_original, context_sentence).
// Everything else — description, translation, hint, tts, SRS state,
// last_seen, streaks, rank — is regenerated from scratch. SRS progress
// is therefore RESET.
//
// Rows missing a context_sentence cannot be replayed and are dropped.
//
// Usage:
//   npx tsx scripts/regenerateAllVocab.ts --dry-run   # preview only
//   npx tsx scripts/regenerateAllVocab.ts --confirm   # actually wipe + replay
//
// Run with the dev server stopped.

import fs from "node:fs";
import path from "node:path";
import { db } from "../lib/db";
import { userVocab } from "../lib/schema";
import { asc } from "drizzle-orm";
import { getUserById } from "../lib/users";
import { saveVocabEntry } from "../lib/vocabSave";

interface OldRow {
  id: number;
  user_id: number;
  target_word_original: string;
  context_sentence: string | null;
  english_description: string;
  native_translation: string | null;
  native_hint: string | null;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const confirmed = args.has("--confirm");
  if (!dryRun && !confirmed) {
    console.error("Refusing to run without --dry-run or --confirm. Use --dry-run first.");
    process.exit(1);
  }

  const rows = (await db
    .select({
      id: userVocab.id,
      user_id: userVocab.userId,
      target_word_original: userVocab.targetWordOriginal,
      context_sentence: userVocab.contextSentence,
      english_description: userVocab.englishDescription,
      native_translation: userVocab.nativeTranslation,
      native_hint: userVocab.nativeHint,
    })
    .from(userVocab)
    .orderBy(asc(userVocab.userId), asc(userVocab.id))) as OldRow[];

  console.log(
    `Found ${rows.length} rows across ${new Set(rows.map((r) => r.user_id)).size} user(s).`,
  );

  const replayable = rows.filter((r) => r.context_sentence && r.context_sentence.trim().length > 0);
  const skipped = rows.length - replayable.length;
  if (skipped > 0) {
    console.warn(`⚠ ${skipped} rows lack context_sentence and cannot be replayed — they will be DROPPED.`);
  }

  // Always write a backup, even on dry-run — cheap insurance.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join("data", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `user_vocab-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(rows, null, 2));
  console.log(`Backup written: ${backupPath}`);

  if (dryRun) {
    console.log("\nDry-run preview (all replayable rows):");
    for (const r of replayable) {
      const ctx = (r.context_sentence ?? "").replace(/\s+/g, " ").slice(0, 70);
      console.log(`  user=${r.user_id} word="${r.target_word_original}"`);
      console.log(`    old desc: ${r.english_description}`);
      console.log(`    context:  ${ctx}${(r.context_sentence ?? "").length > 70 ? "…" : ""}`);
    }
    console.log("\n(Use --confirm to actually wipe and replay.)");
    return;
  }

  // Wipe — only the vocab table; users, conversations, etc. stay intact.
  const deleted = await db.delete(userVocab).returning({ id: userVocab.id });
  console.log(`Deleted ${deleted.length} rows.\n`);

  let inserted = 0;
  let merged = 0;
  let polysemy = 0;
  let failed = 0;

  for (const r of replayable) {
    const user = await getUserById(r.user_id);
    if (!user) {
      console.warn(`  user ${r.user_id} not found, skipping word "${r.target_word_original}"`);
      failed++;
      continue;
    }
    try {
      const res = await saveVocabEntry({
        userId: r.user_id,
        segment: r.target_word_original,
        context_sentence: r.context_sentence!,
        native_language: user.nativeLanguage,
        targetLanguage: user.targetLanguage,
      });
      const tag = res.action.padEnd(20);
      const desc = "description" in res ? res.description : "(merged into existing)";
      console.log(`  ${tag} "${r.target_word_original}" → ${desc}`);
      if (res.action === "inserted") inserted++;
      else if (res.action === "merged") merged++;
      else if (res.action === "polysemy_inserted") polysemy++;
    } catch (err) {
      failed++;
      console.warn(`  FAIL "${r.target_word_original}": ${(err as Error).message}`);
    }
  }

  console.log(
    `\n✓ Replay done. inserted=${inserted} merged=${merged} polysemy=${polysemy} failed=${failed}`,
  );
  console.log(
    "\nTranslation + TTS assets are generating in the background. " +
      "Run `npx tsx scripts/backfillVocabAssets.ts` after ~30s to fill any gaps.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
