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

import { db } from "./db";
import { userVocab } from "./schema";
import { and, eq, sql } from "drizzle-orm";
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

function stageColumnExpr(mode: VocabMode) {
  return mode === "sentence" ? userVocab.stageSentence : userVocab.stage;
}

/**
 * Returns the user's due cards for the given mode, most fragile first.
 * "Due" means now >= last_seen + STAGE_INTERVALS_SECONDS[stage_for_mode].
 *
 * The CASE expression keeps the per-stage interval lookup inside SQL —
 * single round-trip, no JS-side filtering. If STAGE_INTERVALS_SECONDS
 * grows, regenerate the CASE block here in lockstep.
 */
export async function getDueVocabQueue(
  userId: number,
  mode: VocabMode,
  limit: number = 30,
): Promise<DueVocabRow[]> {
  const now = Math.floor(Date.now() / 1000);
  const stageCol = stageColumnExpr(mode);
  // Build CASE expression with INLINE integer literals (sql.raw) — when
  // both the WHEN and THEN branches go through Postgres as `$N` text
  // parameters the result type can't be inferred and the surrounding
  // `last_seen + (...)` fails as `integer + text`. STAGE_INTERVALS_SECONDS
  // is a static module-level constant, no injection risk.
  const caseBody = STAGE_INTERVALS_SECONDS
    .map((seconds, stage) => `WHEN ${stage} THEN ${seconds}`)
    .join(" ");
  const fallback = STAGE_INTERVALS_SECONDS[MAX_STAGE];
  const intervalExpr = sql`CASE ${stageCol} ${sql.raw(caseBody)} ELSE ${sql.raw(String(fallback))} END`;
  const rows = await db
    .select({
      id: userVocab.id,
      target_word_original: userVocab.targetWordOriginal,
      english_description: userVocab.englishDescription,
      stage: stageCol,
      last_seen: userVocab.lastSeen,
    })
    .from(userVocab)
    .where(
      and(
        eq(userVocab.userId, userId),
        sql`${userVocab.lastSeen} + (${intervalExpr}) <= ${now}`,
      ),
    )
    .orderBy(stageCol, userVocab.lastSeen)
    .limit(limit);
  return rows as DueVocabRow[];
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
export async function applyJudgeResult(
  rowId: number,
  userId: number,
  judge: VocabJudgement,
  mode: VocabMode,
): Promise<void> {
  if (judge === "X") return;

  const now = Math.floor(Date.now() / 1000);
  const stageCol = stageColumnExpr(mode);
  const stageColName = mode === "sentence" ? "stage_sentence" : "stage";

  if (judge === "1") {
    await db
      .update(userVocab)
      .set({
        [mode === "sentence" ? "stageSentence" : "stage"]: sql`LEAST(${MAX_STAGE}, ${stageCol} + 1)`,
        lastSeen: now,
        lookedUp: sql`${userVocab.lookedUp} + 1`,
      })
      .where(and(eq(userVocab.id, rowId), eq(userVocab.userId, userId)));
  } else {
    await db
      .update(userVocab)
      .set({
        [mode === "sentence" ? "stageSentence" : "stage"]: sql`GREATEST(0, ${stageCol} / 2)`,
        lastSeen: now,
        lookedUp: sql`${userVocab.lookedUp} + 1`,
      })
      .where(and(eq(userVocab.id, rowId), eq(userVocab.userId, userId)));
  }
  void stageColName;
}
