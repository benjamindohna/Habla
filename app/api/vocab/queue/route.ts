import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDueVocabQueue, type VocabMode } from "@/lib/vocabSrs";

/**
 * Returns the authenticated user's due vocab queue for a given mode.
 * Query params:
 *   - mode:  "recognition" (default) | "sentence"
 *   - limit: 1..100 (default 30)
 * Order: stage_for_mode ASC, last_seen ASC.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit") ?? "30");
  const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : 30;
  const mode: VocabMode = url.searchParams.get("mode") === "sentence" ? "sentence" : "recognition";

  const cards = await getDueVocabQueue(session.userId, mode, limit);
  return NextResponse.json({ cards });
}
