// One-shot backfill: pre-generate native_translation, native_hint, and
// tts_audio for every user_vocab row that's missing any of them.
//
// Usage:
//   npm run backfill-vocab-assets

import { db } from "../lib/db";
import { userVocab } from "../lib/schema";
import { asc, eq, isNull, or } from "drizzle-orm";
import { generateExplanation } from "../lib/vocabExplain";
import { generateTts } from "../lib/vocabTts";
import { getUserById } from "../lib/users";

interface Row {
  id: number;
  user_id: number;
  target_word_original: string;
  word_class: string | null;
  context_sentence: string | null;
  native_translation: string | null;
  tts_audio: Buffer | null;
}

const CONCURRENCY = 4;

async function backfillRow(row: Row): Promise<{ id: number; explainOk: boolean; ttsOk: boolean }> {
  const user = await getUserById(row.user_id);
  if (!user) {
    console.warn(`  row ${row.id}: user ${row.user_id} not found, skipping`);
    return { id: row.id, explainOk: false, ttsOk: false };
  }

  let explainOk = true;
  let ttsOk = true;

  const tasks: Promise<void>[] = [];

  if (!row.native_translation) {
    tasks.push(
      (async () => {
        try {
          const res = await generateExplanation({
            target_word: row.target_word_original,
            word_class: ((row.word_class ?? "noun") as never),
            targetLanguage: user.targetLanguage,
            native_language: user.nativeLanguage,
          });
          await db
            .update(userVocab)
            .set({ nativeTranslation: res.translation })
            .where(eq(userVocab.id, row.id));
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
          await db.update(userVocab).set({ ttsAudio: buf }).where(eq(userVocab.id, row.id));
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
  const rowsRaw = await db
    .select({
      id: userVocab.id,
      user_id: userVocab.userId,
      target_word_original: userVocab.targetWordOriginal,
      word_class: userVocab.wordClass,
      context_sentence: userVocab.contextSentence,
      native_translation: userVocab.nativeTranslation,
      tts_audio: userVocab.ttsAudio,
    })
    .from(userVocab)
    .where(or(isNull(userVocab.nativeTranslation), isNull(userVocab.ttsAudio)))
    .orderBy(asc(userVocab.id));
  const rows = rowsRaw as Row[];

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
