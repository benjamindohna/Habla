import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { applyJudgeResult, type VocabMode } from "@/lib/vocabSrs";
import type { VocabJudgement } from "@/lib/vocab";

/**
 * Apply the SRS state change for a card, scoped to the practice mode.
 * Called by the client at the end of an attempt cycle:
 *   - on a "1" success (stage advances by 1 for the given mode)
 *   - on a "0" give-up after 3 failed tries (stage halves)
 *
 * "X" verdicts never commit — they're no-ops in the SRS model.
 *
 * Body:
 *   { rowId: number, result: "1" | "0" | "X", mode: "recognition" | "sentence" }
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
  if (result !== "1" && result !== "0" && result !== "X") {
    return NextResponse.json({ error: "result must be 1, 0 or X" }, { status: 400 });
  }
  const mode: VocabMode = body.mode === "sentence" ? "sentence" : "recognition";

  applyJudgeResult(rowId, session.userId, result, mode);
  return NextResponse.json({ ok: true });
}
