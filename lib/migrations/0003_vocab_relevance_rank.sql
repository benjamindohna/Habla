-- Add personalised relevance ranking to user_vocab. Lower rank = more
-- important for mastering the target language. Filled in by the
-- vocab-ranking pipeline (lib/vocabRanking.ts) on every save:
--   ≤ BULK_SORT_THRESHOLD rows: re-rank everything in one LLM call
--   >  threshold:               3-anchor binary insert for the new row
-- Existing rows get a placeholder rank by id-order; they'll be re-ranked
-- properly on the next save (bulk if total ≤ threshold).

ALTER TABLE user_vocab ADD COLUMN relevance_rank INTEGER NOT NULL DEFAULT 999999;

CREATE INDEX IF NOT EXISTS idx_user_vocab_rank ON user_vocab(user_id, relevance_rank);

-- Backfill: 0-based rank within each user, ordered by id.
UPDATE user_vocab
SET relevance_rank = (
  SELECT COUNT(*) FROM user_vocab v2
  WHERE v2.user_id = user_vocab.user_id AND v2.id < user_vocab.id
);
