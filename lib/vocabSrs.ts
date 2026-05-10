// SRS scheduling helpers for vocabulary practice.
//
// Two operations:
//   - getDueVocabQueue: returns rows whose last_seen + stage-interval has
//     elapsed, sorted by stage ASC then last_seen ASC. Lower-stage cards
//     come first (most fragile); within a stage, the longest-untouched
//     card surfaces first (rotation, prevents always-same-card).
//   - applyJudgeResult: writes the post-judge state. "1" → stage up,
//     "0" → stage halved (Math.floor) + lapse counter, "X" → no-op
//     (the card stays in the queue with unchanged stage and last_seen).
//
// Intervals are hardcoded in lib/vocab.ts (STAGE_INTERVALS_SECONDS).
// Per-user customisation is possible later via a DB column; not v1.

import { getDb } from "./db";
import { MAX_STAGE, STAGE_INTERVALS_SECONDS, type VocabJudgement } from "./vocab";

export interface DueVocabRow {
  id: number;
  target_word_original: string;
  english_description: string;
  stage: number;
  last_seen: number;
}

/**
 * Returns the user's due cards (most fragile first), capped at `limit`.
 * "Due" means now >= last_seen + STAGE_INTERVALS_SECONDS[stage].
 *
 * The CASE expression keeps the per-stage interval lookup inside SQL —
 * single round-trip, no JS-side filtering. If STAGE_INTERVALS_SECONDS
 * grows, regenerate the CASE block here in lockstep.
 */
export function getDueVocabQueue(userId: number, limit: number = 30): DueVocabRow[] {
  const now = Math.floor(Date.now() / 1000);
  const caseClauses = STAGE_INTERVALS_SECONDS
    .map((seconds, stage) => `WHEN ${stage} THEN ${seconds}`)
    .join(" ");
  const sql = `
    SELECT id, target_word_original, english_description, stage, last_seen
    FROM user_vocab
    WHERE user_id = ?
      AND last_seen + (CASE stage ${caseClauses} ELSE ${STAGE_INTERVALS_SECONDS[MAX_STAGE]} END) <= ?
    ORDER BY stage ASC, last_seen ASC
    LIMIT ?
  `;
  return getDb().prepare(sql).all(userId, now, limit) as DueVocabRow[];
}

/**
 * Apply the SRS state change for a row given the judge verdict.
 *
 * "1": stage = MIN(MAX_STAGE, stage + 1); last_seen = now; looked_up += 1.
 * "0": stage = MAX(0, FLOOR(stage / 2));   last_seen = now; looked_up += 1.
 * "X": no-op — caller should not invoke this with X verdicts. The card
 *      remains in the queue at the same stage and last_seen.
 *
 * looked_up bumps on every committed test-mode review (same intent as
 * the chat-re-tap path: the counter faithfully reflects how often the
 * user has encountered this word, regardless of outcome).
 */
export function applyJudgeResult(rowId: number, userId: number, judge: VocabJudgement): void {
  if (judge === "X") return;

  const now = Math.floor(Date.now() / 1000);
  const db = getDb();
  if (judge === "1") {
    db.prepare(
      `UPDATE user_vocab
       SET stage = MIN(?, stage + 1), last_seen = ?, looked_up = looked_up + 1
       WHERE id = ? AND user_id = ?`,
    ).run(MAX_STAGE, now, rowId, userId);
  } else {
    // "0" — wrong answer. Halve the stage (floor).
    db.prepare(
      `UPDATE user_vocab
       SET stage = MAX(0, stage / 2), last_seen = ?, looked_up = looked_up + 1
       WHERE id = ? AND user_id = ?`,
    ).run(now, rowId, userId);
  }
}
