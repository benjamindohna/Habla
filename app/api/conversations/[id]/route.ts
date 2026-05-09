import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConversation, getMessages } from "@/lib/conversations";

/**
 * Load a conversation and its full message history. Used by /chat/[id]
 * to hydrate the page on mount. Authorisation: only the conversation's
 * owner can read it.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await ctx.params;
  const conversationId = Number(id);
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    return NextResponse.json({ error: "Invalid conversation id" }, { status: 400 });
  }

  const conversation = getConversation(conversationId);
  if (!conversation || conversation.user_id !== session.userId) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const messages = getMessages(conversationId);
  return NextResponse.json({
    conversation: {
      id: conversation.id,
      topic: conversation.topic,
      created_at: conversation.created_at,
      ended_at: conversation.ended_at,
    },
    messages,
  });
}
