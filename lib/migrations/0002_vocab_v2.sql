-- Vocab v2: switch from native-translation-anchored storage to
-- English-description-anchored storage. See ROADMAP.md
-- "Vocabulary save & test (English-description-anchored)" and
-- DISREGARDED_IDEAS.md for the design rationale.
--
-- The old user_unknown_words table held Phase 8 scaffolding data
-- (`(word, native_translation, freq_rank, looked_up, last_seen)` keyed
-- by `(user_id, word)`). Per the user's call, we drop it outright —
-- the data was pre-SRS and not worth migrating.

DROP TABLE IF EXISTS user_unknown_words;

CREATE TABLE IF NOT EXISTS user_vocab (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The word (or multi-word segment) as encountered, with original casing
  -- preserved. Surface form is preserved per the storage rule —
  -- "comió" stays "comió", never lemmatised to "comer".
  target_word_original  TEXT    NOT NULL,
  -- Lowercased, NFC-normalised, edge-punct-stripped form. Used as the
  -- dedup key — collisions on this trigger the comparator LLM.
  target_word_lower     TEXT    NOT NULL,
  -- LLM-generated English sense-key (3-7 words). Two synonymous saves
  -- produce identical descriptions; two distinct senses produce
  -- noticeably different ones. Used for synonym vs polysemy decisions.
  english_description   TEXT    NOT NULL,
  -- The AI-bubble sentence the word was tapped in. Kept for audit /
  -- description regeneration / optional UI hints.
  context_sentence      TEXT,
  -- SRS state per the discrete-stage system in ROADMAP §1.
  stage                 INTEGER NOT NULL DEFAULT 0,
  next_due_at           INTEGER,
  correct_streak        INTEGER NOT NULL DEFAULT 0,
  lapses                INTEGER NOT NULL DEFAULT 0,
  -- Bookkeeping.
  looked_up             INTEGER NOT NULL DEFAULT 1,
  last_seen             INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  created_at            INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- Dedup lookup: at save time we check for collisions by (user_id, target_word_lower).
CREATE INDEX IF NOT EXISTS idx_user_vocab_user_lower
  ON user_vocab(user_id, target_word_lower);

-- SRS scheduling: pick the next-due row for the user.
CREATE INDEX IF NOT EXISTS idx_user_vocab_user_due
  ON user_vocab(user_id, next_due_at);
