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
import { MAX_STAGE, STAGE_INTERVALS_SECONDS, projectNextStage, type VocabJudgement } from "./vocab";

export type VocabMode = "recognition" | "sentence";

export interface DueVocabRow {
  id: number;
  target_word_original: string;
  /** Deprecated: pre-refactor sense-key, kept on legacy rows. Use
   *  word_class for new logic. Null on rows inserted after the refactor. */
  english_description: string | null;
  word_class: string | null;
  /** Stage for the queried MODE (aliased from stage / stage_sentence). */
  stage: number;
  last_seen: number;
  /** Cached native-language translation, populated by
   *  generateAssetsAsync at save time or by the explain endpoint on
   *  first reveal. Sent down with the queue so flipping a card no
   *  longer requires a second roundtrip — the client uses it directly
   *  and only falls back to /api/vocab/explain when null (brand-new
   *  card before the async job lands). */
  native_translation: string | null;
  /** Deprecated: hint field removed post-refactor. Stays in the type
   *  for backwards compat with legacy rows; always null for new rows. */
  native_hint: string | null;
}

function stageColumnExpr(mode: VocabMode) {
  return mode === "sentence" ? userVocab.stageSentence : userVocab.stage;
}

/**
 * Returns the user's due cards for the given mode as a MIXED queue.
 * "Due" means now >= last_seen + STAGE_INTERVALS_SECONDS[stage_for_mode].
 *
 * Why mixed: with a large due backlog, a pure oldest-first order
 * starves fresh vocab — words saved from yesterday's conversation sat
 * behind 50+ stale cards and never surfaced (observed in prod with 82
 * due stage-0 cards). But the freshest words are the hottest learning
 * material: the user still remembers the context they came from.
 *
 * So the queue reserves half its slots for the most recently CREATED
 * due cards (fresh first) and fills the rest with the oldest-due
 * backlog (most fragile first). Fresh cards lead the deck; the backlog
 * still drains every session.
 *
 * The CASE expression keeps the per-stage interval lookup inside SQL —
 * single round-trip per half, no JS-side filtering. If
 * STAGE_INTERVALS_SECONDS grows, regenerate the CASE block here in
 * lockstep.
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

  const selection = {
    id: userVocab.id,
    target_word_original: userVocab.targetWordOriginal,
    english_description: userVocab.englishDescription,
    word_class: userVocab.wordClass,
    stage: stageCol,
    last_seen: userVocab.lastSeen,
    native_translation: userVocab.nativeTranslation,
    native_hint: userVocab.nativeHint,
  };
  const dueFilter = and(
    eq(userVocab.userId, userId),
    sql`${userVocab.lastSeen} + (${intervalExpr}) <= ${now}`,
  );

  const freshLimit = Math.ceil(limit / 2);
  const fresh = await db
    .select(selection)
    .from(userVocab)
    .where(dueFilter)
    .orderBy(sql`${userVocab.createdAt} DESC`)
    .limit(freshLimit);

  const freshIds = new Set(fresh.map((r) => r.id));
  const backlog = (
    await db
      .select(selection)
      .from(userVocab)
      .where(dueFilter)
      .orderBy(stageCol, userVocab.lastSeen)
      .limit(limit)
  ).filter((r) => !freshIds.has(r.id));

  return [...fresh, ...backlog].slice(0, limit) as DueVocabRow[];
}

/**
 * Apply the SRS state change for a row given the judge verdict and mode.
 *
 * Verdict → new stage delegates to projectNextStage() — single source of
 * truth shared with the UI's "wann kommt's wieder"-preview. Don't reproduce
 * the +1 / +2 / floor(/2) arithmetic here.
 *
 *   "0": stage = floor(stage / 2); last_seen = now (no fuzz).
 *   "1": stage += 1 (capped);      last_seen = now + fuzz.
 *   "2": stage += 2 (capped);      last_seen = now + fuzz.
 *   "X": no-op.
 *
 * Anti-cluster fuzz (Anki-style): on a positive verdict last_seen gets
 * a random [0, +15%] of the NEW stage's interval added — so the batch
 * of words saved from one conversation drifts apart over time instead
 * of all coming due synchronously. Only-positive so we never push
 * last_seen into the past, which would risk falsely triggering the
 * soft-lapse-on-re-tap path in vocabSave (it uses last_seen <
 * now-cooldown as its trigger). Slight ~+7.5% mean shift on intervals
 * — negligible vs. the cluster-breaking benefit. No fuzz on "0"
 * lapses: the floored card needs to come back at the floor interval
 * exactly, not a tick later.
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
  const stageKey = mode === "sentence" ? "stageSentence" : "stage";

  const current = await db
    .select({ stage: stageCol })
    .from(userVocab)
    .where(and(eq(userVocab.id, rowId), eq(userVocab.userId, userId)))
    .limit(1);
  const currentStage = current[0]?.stage ?? 0;
  const newStage = projectNextStage(currentStage, judge);

  const isLapse = judge === "0";
  const intervalSeconds = STAGE_INTERVALS_SECONDS[newStage];
  const fuzz = isLapse ? 0 : Math.round(Math.random() * 0.15 * intervalSeconds);

  await db
    .update(userVocab)
    .set({
      [stageKey]: sql.raw(String(newStage)),
      lastSeen: now + fuzz,
      lookedUp: sql`${userVocab.lookedUp} + 1`,
    })
    .where(and(eq(userVocab.id, rowId), eq(userVocab.userId, userId)));
}
