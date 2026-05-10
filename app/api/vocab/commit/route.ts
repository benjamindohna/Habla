import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { applyJudgeResult } from "@/lib/vocabSrs";
import type { VocabJudgement } from "@/lib/vocab";

/**
 * Apply the SRS state change for a card. Called by the client at the
 * end of an attempt cycle:
 *   - on a "1" success (stage advances)
 *   - on a "0" give-up after 3 failed tries (stage halves, lapse + 1)
 *
 * "X" verdicts never commit — they're no-ops in the SRS model.
 * Sending an "X" here is silently dropped.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    rowId?: number;
    result?: VocabJudgement;
  };
  const { rowId, result } = body;

  if (typeof rowId !== "number" || !Number.isFinite(rowId) || rowId <= 0) {
    return NextResponse.json({ error: "rowId required" }, { status: 400 });
  }
  if (result !== "1" && result !== "0" && result !== "X") {
    return NextResponse.json({ error: "result must be 1, 0 or X" }, { status: 400 });
  }

  applyJudgeResult(rowId, session.userId, result);
  return NextResponse.json({ ok: true });
}
