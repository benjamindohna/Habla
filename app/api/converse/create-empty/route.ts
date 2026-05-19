import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { createConversation } from "@/lib/conversations";

/**
 * Create an empty conversation row and return its id. The user lands
 * in /chat/[id] with no AI opener and no topic; they then either tap a
 * topic from the inline grid (→ /api/converse/start sets the topic and
 * generates the opener) or start speaking directly (→ topic is derived
 * from their first message in /api/converse/turn).
 *
 * If the user navigates back without interacting, the chat is cleaned
 * up via DELETE /api/conversations/[id]. The "still empty" check there
 * prevents accidental deletion of conversations that have content.
 *
 * topic is stored as the empty string "" (NOT NULL constraint stays
 * intact); downstream code treats `topic === ""` as "no topic yet".
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const conversationId = await createConversation(user.id, "");
  return NextResponse.json({ conversationId });
}
