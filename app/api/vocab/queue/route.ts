import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDueVocabQueue, type VocabMode, type VocabQueueSort } from "@/lib/vocabSrs";

/**
 * Returns the authenticated user's practice queue for a given mode.
 * Query params:
 *   - mode:    "recognition" (default) | "sentence"
 *   - limit:   1..100 (default 30)
 *   - sort:    "due" (default, mixed fresh+backlog) | "recent" |
 *              "important" | "wrong" — non-due sorts ignore dueness
 *              (free practice over the whole list).
 *   - exclude: comma-separated row ids already practiced this session,
 *              so "load next batch" skips them.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit") ?? "30");
  const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : 30;
  const mode: VocabMode = url.searchParams.get("mode") === "sentence" ? "sentence" : "recognition";
  const sortParam = url.searchParams.get("sort");
  const sort: VocabQueueSort =
    sortParam === "recent" || sortParam === "important" || sortParam === "wrong"
      ? sortParam
      : "due";
  const excludeIds = (url.searchParams.get("exclude") ?? "")
    .split(",")
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 500);

  const cards = await getDueVocabQueue(session.userId, mode, limit, sort, excludeIds);
  return NextResponse.json({ cards });
}
