/**
 * One segment pair from the AI alignment engine.
 * Ordered by the local Spanish sentence (left to right).
 *
 * - is_match true  → learner was already correct; render local_segment as plain text.
 * - is_match false → mismatch; show user_segment above in red, local_segment in green chip.
 */
export interface Pair {
  local_segment: string;
  user_segment: string;
  is_match: boolean;
  comment_native: string;
}

/**
 * The structured result returned by /api/correct.
 * Drives the CorrectionBlock renderer — no string-parsing needed downstream.
 */
export interface CorrectionResult {
  transcript_raw: string;
  intended_meaning_native: string;
  local_version_es: string;
  confidence: "high" | "medium" | "low";
  notes_native: string;
  pairs: Pair[];
}
