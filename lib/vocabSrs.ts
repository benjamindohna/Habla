// SRS scheduling helpers for vocabulary practice — per-mode.
//
// Each card has TWO SRS stages, one per practice mode:
//   stage           → recognition mode (/vocab/practice — translate)
//   stage_sentence  → production mode  (/vocab/sentence  — use it)
// Both use the same STAGE_INTERVALS_SECONDS ladder. Queue / commit /
// applyJudgeResult all take a `mode` parameter selecting which column
// to read/write.
//
// last_seen is shared (one timestamp per row). It's updated on every
// committed review in either mode, on chat re-tap, and otherwise
// gates "due" status via last_seen + interval[stage_for_mode].

import { getDb } from "./db";
import { MAX_STAGE, STAGE_INTERVALS_SECONDS, type VocabJudgement } from "./vocab";

export type VocabMode = "recognition" | "sentence";

export interface DueVocabRow {
  id: number;
  target_word_original: string;
  english_description: string;
  /** Stage for the queried MODE (aliased from stage / stage_sentence). */
  stage: number;
  last_seen: number;
}

function stageColumn(mode: VocabMode): "stage" | "stage_sentence" {
  return mode === "sentence" ? "stage_sentence" : "stage";
}

/**
 * Returns the user's due cards for the given mode, most fragile first.
 * "Due" means now >= last_seen + STAGE_INTERVALS_SECONDS[stage_for_mode].
 *
 * The CASE expression keeps the per-stage interval lookup inside SQL —
 * single round-trip, no JS-side filtering. If STAGE_INTERVALS_SECONDS
 * grows, regenerate the CASE block here in lockstep.
 */
export function getDueVocabQueue(
  userId: number,
  mode: VocabMode,
  limit: number = 30,
): DueVocabRow[] {
  const now = Math.floor(Date.now() / 1000);
  const col = stageColumn(mode);
  const caseClauses = STAGE_INTERVALS_SECONDS
    .map((seconds, stage) => `WHEN ${stage} THEN ${seconds}`)
    .join(" ");
  const sql = `
    SELECT id, target_word_original, english_description,
           ${col} AS stage, last_seen
    FROM user_vocab
    WHERE user_id = ?
      AND last_seen + (CASE ${col} ${caseClauses} ELSE ${STAGE_INTERVALS_SECONDS[MAX_STAGE]} END) <= ?
    ORDER BY ${col} ASC, last_seen ASC
    LIMIT ?
  `;
  return getDb().prepare(sql).all(userId, now, limit) as DueVocabRow[];
}

/**
 * Apply the SRS state change for a row given the judge verdict and mode.
 *
 * "1": stage_for_mode = MIN(MAX_STAGE, +1); last_seen = now; looked_up += 1.
 * "0": stage_for_mode = MAX(0, FLOOR(/2));  last_seen = now; looked_up += 1.
 * "X": no-op — caller should not invoke this with X verdicts.
 *
 * Only the stage column for the queried mode is touched. The other
 * mode's stage stays unchanged.
 */
export function applyJudgeResult(
  rowId: number,
  userId: number,
  judge: VocabJudgement,
  mode: VocabMode,
): void {
  if (judge === "X") return;

  const now = Math.floor(Date.now() / 1000);
  const col = stageColumn(mode);
  const db = getDb();
  if (judge === "1") {
    db.prepare(
      `UPDATE user_vocab
       SET ${col} = MIN(?, ${col} + 1), last_seen = ?, looked_up = looked_up + 1
       WHERE id = ? AND user_id = ?`,
    ).run(MAX_STAGE, now, rowId, userId);
  } else {
    db.prepare(
      `UPDATE user_vocab
       SET ${col} = MAX(0, ${col} / 2), last_seen = ?, looked_up = looked_up + 1
       WHERE id = ? AND user_id = ?`,
    ).run(now, rowId, userId);
  }
}
