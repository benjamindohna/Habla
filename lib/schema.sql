-- Habla local database schema. Re-applied idempotently on every server boot.

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  native_language TEXT NOT NULL DEFAULT 'German',
  level           INTEGER NOT NULL DEFAULT 30,
  interests_text  TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS user_interests (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interest   TEXT NOT NULL,
  added_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  is_recent  INTEGER NOT NULL DEFAULT 0, -- 1 = currently active interest (last few chats); 0 = background
  PRIMARY KEY (user_id, interest)
);

CREATE TABLE IF NOT EXISTS user_unknown_words (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word       TEXT NOT NULL,
  freq_rank  INTEGER,
  looked_up  INTEGER NOT NULL DEFAULT 1,
  last_seen  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (user_id, word)
);

CREATE TABLE IF NOT EXISTS conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic      TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  ended_at   INTEGER -- set when the user presses Done; NULL while conversation is active
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('ai','user')),
  text_es         TEXT NOT NULL,
  user_raw        TEXT,
  segments_json   TEXT,
  created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_conv_id ON messages(conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id, id);
