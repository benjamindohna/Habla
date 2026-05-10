import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDueVocabQueue } from "@/lib/vocabSrs";

/**
 * Returns the authenticated user's due vocab queue. Order: stage ASC,
 * last_seen ASC. Capped at 30 rows by default.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit") ?? "30");
  const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : 30;

  const cards = getDueVocabQueue(session.userId, limit);
  return NextResponse.json({ cards });
}
