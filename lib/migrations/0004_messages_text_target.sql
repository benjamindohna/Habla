-- Rename messages.text_es → messages.text_target as part of de-Spanishing
-- the schema. The column holds whatever the user's target language is, not
-- specifically Spanish. See ROADMAP / TARGET_LANGUAGE_MIGRATION.md for the
-- full audit.
--
-- SQLite supports ALTER TABLE ... RENAME COLUMN since 3.25.0.

ALTER TABLE messages RENAME COLUMN text_es TO text_target;
