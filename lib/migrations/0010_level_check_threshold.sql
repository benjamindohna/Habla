-- Per-user counter of user inputs accumulated since the last
-- successful level check. Reset to 0 inside runLevelCheckIfDue when a
-- check actually fires; incremented on every pushRecentInput call.
--
-- Drives the new firing rule:
--   - Cooldown: ≥6h since last_level_check_at
--   - Gate:     samples_since_last_check ≥ 3
--   - Content:  the recent_inputs_json ring is already full (5 items)
--
-- Sequencing: if the cooldown has elapsed but the gate hasn't yet been
-- met, the next qualifying input flips the gate and the check fires
-- immediately on that input — regardless of additional wall-clock time.

ALTER TABLE users
ADD COLUMN samples_since_last_check INTEGER NOT NULL DEFAULT 0;
