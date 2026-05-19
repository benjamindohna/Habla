// One-shot backfill: pre-generate native_translation, native_hint, and
// tts_audio for every user_vocab row that's missing any of them. Run
// once after migration 0006 is applied; future inserts trigger
// generation automatically via vocabSave.
//
// Usage:
//   npm run backfill-vocab-assets
//
// Concurrency capped at 4 to stay polite with OpenAI rate limits.
// Cost roughly $0.0016 per row (~$0.05 for 30 rows).
//
// Run with the dev server stopped — better-sqlite3 in WAL mode tolerates
// concurrent reads but write contention with a long-running server is
// avoidable.

import { getDb } from "../lib/db";
import { generateExplanation } from "../lib/vocabExplain";
import { generateTts } from "../lib/vocabTts";
import { getUserById } from "../lib/users";

interface Row {
  id: number;
  user_id: number;
  target_word_original: string;
  context_sentence: string | null;
  native_translation: string | null;
  native_hint: string | null;
  tts_audio: Buffer | null;
}

const CONCURRENCY = 4;

async function backfillRow(row: Row): Promise<{ id: number; explainOk: boolean; ttsOk: boolean }> {
  const user = getUserById(row.user_id);
  if (!user) {
    console.warn(`  row ${row.id}: user ${row.user_id} not found, skipping`);
    return { id: row.id, explainOk: false, ttsOk: false };
  }

  let explainOk = true;
  let ttsOk = true;

  const tasks: Promise<void>[] = [];

  if (!row.native_translation || row.native_hint === null) {
    tasks.push(
      (async () => {
        try {
          const res = await generateExplanation({
            target_word: row.target_word_original,
            context_sentence: row.context_sentence ?? "",
            targetLanguage: user.targetLanguage,
            native_language: user.nativeLanguage,
          });
          getDb()
            .prepare(
              `UPDATE user_vocab SET native_translation = ?, native_hint = ?
               WHERE id = ?`,
            )
            .run(res.translation, res.hint, row.id);
        } catch (err) {
          explainOk = false;
          console.warn(`  row ${row.id} explain failed:`, (err as Error).message);
        }
      })(),
    );
  }

  if (!row.tts_audio || row.tts_audio.length === 0) {
    tasks.push(
      (async () => {
        try {
          const buf = await generateTts(row.target_word_original, user.targetLanguage);
          getDb()
            .prepare(`UPDATE user_vocab SET tts_audio = ? WHERE id = ?`)
            .run(buf, row.id);
        } catch (err) {
          ttsOk = false;
          console.warn(`  row ${row.id} tts failed:`, (err as Error).message);
        }
      })(),
    );
  }

  await Promise.all(tasks);
  return { id: row.id, explainOk, ttsOk };
}

async function main() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, user_id, target_word_original, context_sentence,
              native_translation, native_hint, tts_audio
       FROM user_vocab
       WHERE native_translation IS NULL
          OR native_hint IS NULL
          OR tts_audio IS NULL
       ORDER BY id`,
    )
    .all() as Row[];

  if (rows.length === 0) {
    console.log("All rows already have assets — nothing to do.");
    return;
  }

  console.log(`Backfilling ${rows.length} rows (concurrency ${CONCURRENCY})…`);
  const startMs = Date.now();
  let done = 0;
  let explainFails = 0;
  let ttsFails = 0;

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(backfillRow));
    for (const r of results) {
      done++;
      if (!r.explainOk) explainFails++;
      if (!r.ttsOk) ttsFails++;
    }
    console.log(`  ${done}/${rows.length}`);
  }

  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(
    `\n✓ Done. ${done} rows processed in ${elapsedSec}s. ` +
      `Explain failures: ${explainFails}. TTS failures: ${ttsFails}. ` +
      `(Re-run to retry failed rows.)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
