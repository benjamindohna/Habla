-- Cache the LLM-generated translation + hint and the TTS audio per
-- user_vocab row. Generated once at insert time (async, fire-and-forget
-- in vocabSave) and read-through cached on the explain + TTS endpoints.
--
-- native_translation: vocab-card-style native-language translation
-- native_hint:        short native-language example / memory aid
-- tts_audio:          MP3 blob of the target_word_original
--
-- All three nullable: existing rows backfilled by scripts/backfillVocabAssets.ts;
-- new rows generate them async after insert. Endpoints fall back to live
-- generation when the cache is empty (and write back the result).

ALTER TABLE user_vocab ADD COLUMN native_translation TEXT;
ALTER TABLE user_vocab ADD COLUMN native_hint TEXT;
ALTER TABLE user_vocab ADD COLUMN tts_audio BLOB;
