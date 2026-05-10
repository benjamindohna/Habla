-- Adaptive level tracking.
--
-- recent_inputs_json: FIFO ring of up to 5 most recent raw STT
--                     transcripts from the chat. Pushed in
--                     /api/correct as the user submits a turn. JSON
--                     array of strings, oldest first.
--
-- last_level_check_at: Unix timestamp of the last automated level
--                     assessment. NULL = never. The check fires when
--                     we have 5 inputs AND (last_check is NULL or
--                     > 24h ago). One LLM call, ~$0.0001 per check,
--                     max ±3 level adjustment per run.

ALTER TABLE users ADD COLUMN recent_inputs_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN last_level_check_at INTEGER;
