import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { applyJudgeResult, type VocabMode } from "@/lib/vocabSrs";
import type { VocabJudgement } from "@/lib/vocab";

/**
 * Apply the SRS state change for a card, scoped to the practice mode.
 * Called by the client after the learner self-judges the revealed card:
 *   - "0" — Falsch:    stage = floor(stage / 2)
 *   - "1" — Gut:       stage + 1
 *   - "2" — Sehr gut:  stage + 2  (Anki "Easy" — skips a level)
 *   - "X" — no-op (still used by the sentence-mode judge)
 *
 * Body:
 *   { rowId: number, result: "0" | "1" | "2" | "X", mode: "recognition" | "sentence" }
 *
 * mode defaults to "recognition" if absent (backwards-compat).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    rowId?: number;
    result?: VocabJudgement;
    mode?: string;
  };
  const { rowId, result } = body;

  if (typeof rowId !== "number" || !Number.isFinite(rowId) || rowId <= 0) {
    return NextResponse.json({ error: "rowId required" }, { status: 400 });
  }
  if (result !== "1" && result !== "0" && result !== "2" && result !== "X") {
    return NextResponse.json({ error: "result must be 0, 1, 2 or X" }, { status: 400 });
  }
  const mode: VocabMode = body.mode === "sentence" ? "sentence" : "recognition";

  await applyJudgeResult(rowId, session.userId, result, mode);
  return NextResponse.json({ ok: true });
}
