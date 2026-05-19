import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteConversationIfEmpty, getConversation, getMessages } from "@/lib/conversations";

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

  const conversation = await getConversation(conversationId);
  if (!conversation || conversation.user_id !== session.userId) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const messages = await getMessages(conversationId);
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

/**
 * Delete an empty conversation. Used by /chat/[id] for the empty-chat
 * cleanup when the user navigates away without recording or picking a
 * topic. Strictly empty-only — a chat with any messages is left
 * untouched (returns 409). Authorisation: owner only.
 */
export async function DELETE(
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

  const deleted = await deleteConversationIfEmpty(session.userId, conversationId);
  if (!deleted) {
    return NextResponse.json({ error: "Conversation not empty or not found" }, { status: 409 });
  }
  return NextResponse.json({ deleted: true });
}
