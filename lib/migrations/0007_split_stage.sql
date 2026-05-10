-- Split the single SRS stage into two: one per practice mode.
--
--   stage           — recognition mode (translate the word).
--   stage_sentence  — production mode (use the word in a sentence).
--
-- Both default to 0 and use the same STAGE_INTERVALS_SECONDS ladder.
-- A correct answer advances the relevant column; a wrong answer halves
-- it. Chat soft-lapse halves both (the re-tap signal is independent
-- of which practice mode the card is studied in).
--
-- Existing rows: stage_sentence defaults to 0, meaning all existing
-- words are immediately due for sentence-mode practice on their first
-- visit to /vocab/sentence. Existing stage values are preserved as
-- the recognition stage.

ALTER TABLE user_vocab ADD COLUMN stage_sentence INTEGER NOT NULL DEFAULT 0;
