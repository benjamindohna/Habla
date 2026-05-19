import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getRecentConversations } from "@/lib/conversations";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

/**
 * Recent non-empty conversations for the homepage list. The query
 * filters out conversations with zero messages so abandoned empty
 * chats (e.g. browser-closed before any interaction) don't pollute
 * the list — they're stale and meaningless to the user.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json({ error: "invalid limit" }, { status: 400 });
    }
    limit = Math.min(Math.floor(parsed), MAX_LIMIT);
  }

  const conversations = await getRecentConversations(session.userId, limit);
  return NextResponse.json({ conversations });
}
