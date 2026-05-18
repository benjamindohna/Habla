-- Per-user target language.
--
-- Each user picks the language they're learning + region/style. Prompts
-- now thread this through from the session user instead of importing a
-- global DEFAULT_TARGET, so different users in the same DB can have
-- different target languages.
--
-- Column stores a JSON-serialised TargetLanguageSpec (see
-- lib/targetLanguage.ts). Default = the previous global default
-- (everyday Castellano Spanish) so existing rows continue to behave
-- identically without backfill.

ALTER TABLE users
ADD COLUMN target_language_json TEXT NOT NULL
DEFAULT '{"language":"Spanish","location":"castellano","style":"everyday"}';
