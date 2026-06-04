// SRS constants + pure helper functions used by both client UI
// (vocab/practice page rendering "in X kommt die Karte wieder" labels)
// and server SRS state-update code. Lives in its own file with ZERO
// imports so client components can use these helpers without dragging
// lib/llm.ts → lib/db.ts → postgres into the browser bundle.

export type VocabJudgement = "1" | "X" | "0" | "2";

// SRS interval ladder, indexed by stage. After a "1" or "2" verdict
// the card moves up; after "0" stage = floor(stage / 2); "X" is a no-op.
export const STAGE_INTERVALS_SECONDS = [
  600,          // stage 0:  10 min  (same-session learning step)
  86_400,       // stage 1:  1 day
  216_000,      // stage 2:  2.5 days
  518_400,      // stage 3:  6 days
  1_296_000,    // stage 4:  15 days
  3_283_200,    // stage 5:  38 days
  8_208_000,    // stage 6:  95 days
  20_736_000,   // stage 7:  240 days  (~8 months)
  51_840_000,   // stage 8:  600 days  (~1.6 years)
  129_600_000,  // stage 9:  1500 days (~4 years)
];

export const MAX_STAGE = STAGE_INTERVALS_SECONDS.length - 1;

/**
 * Render a stage interval (seconds) as a short German label for UI
 * preview ("wann kommt die Karte wieder"). Designed for the three
 * reveal-buttons in the practice page; uses round numbers, not exact
 * arithmetic — the user wants a feel, not a stopwatch.
 */
export function formatStageInterval(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h`;
  const days = seconds / 86_400;
  if (days < 1.5) return "1 Tag";
  if (days < 14) return `${days < 10 ? days.toFixed(1).replace(".0", "") : Math.round(days)} Tage`;
  if (days < 60) return `${Math.round(days / 7)} Wo.`;
  if (days < 365) return `${Math.round(days / 30)} Mon.`;
  const years = days / 365;
  return years < 10 ? `${years.toFixed(1).replace(".0", "")} J.` : `${Math.round(years)} J.`;
}

/**
 * Compute the stage a card would land in if the learner clicked the
 * given verdict — used by the UI to render "in X kommt die Karte
 * wieder" labels under the three reveal-buttons. Mirrors the branches
 * in applyJudgeResult exactly. "X" is a no-op (same stage).
 */
export function projectNextStage(currentStage: number, verdict: VocabJudgement): number {
  if (verdict === "0") return Math.max(0, Math.floor(currentStage / 2));
  if (verdict === "1") return Math.min(MAX_STAGE, currentStage + 1);
  if (verdict === "2") return Math.min(MAX_STAGE, currentStage + 2);
  return currentStage;
}
