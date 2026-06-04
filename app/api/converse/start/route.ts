import { NextRequest, NextResponse } from "next/server";
import { chatText } from "@/lib/llm";
import { getSession } from "@/lib/auth";
import { withRouteUsage } from "@/lib/usageContext";
import { getUserById } from "@/lib/users";
import { describeTargetLanguage } from "@/lib/targetLanguage";
import { describeLevelForPrompt } from "@/lib/levels";
import {
  appendMessage,
  createConversation,
  getConversation,
  updateConversationTopic,
} from "@/lib/conversations";

/**
 * Set the topic on a conversation and generate the AI's opener. Two
 * call shapes:
 *   { conversationId, topic } — set topic on an existing empty chat
 *     (created via /api/converse/create-empty). Required path for the
 *     new homepage UX where the user enters an empty chat and may pick
 *     a topic inline from the recommendation grid.
 *   { topic } — legacy shape: create a fresh conversation atomically.
 *     Kept so older callers (and tests / playground) still work.
 *
 * In both cases the AI opener becomes the conversation's first message.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  return withRouteUsage("/api/converse/start", session?.userId ?? null, async () => {
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    topic?: string;
    conversationId?: number;
  };
  const { topic, conversationId: existingId } = body;
  if (!topic || typeof topic !== "string" || !topic.trim()) {
    return NextResponse.json({ error: "topic required" }, { status: 400 });
  }
  if (existingId !== undefined && (typeof existingId !== "number" || !Number.isFinite(existingId) || existingId <= 0)) {
    return NextResponse.json({ error: "invalid conversationId" }, { status: 400 });
  }

  const target = describeTargetLanguage(user.targetLanguage);
  const targetName = user.targetLanguage.language;
  const nativeLanguage = user.nativeLanguage;
  const levelBlock = describeLevelForPrompt(user.level, user.targetLanguage);

  const prompt = `You are a native ${target} speaker opening a casual conversation about a topic with a learner whose native language is ${nativeLanguage}.

Topic: "${topic.trim()}"

${levelBlock}

Write a single opening message in ${target} that:
- Is genuinely interesting and inviting — not a generic "Do you like X?".
- Asks a thoughtful, specific question about the topic that invites a real opinion, story, or take. Always end with a question — the conversation needs a hook from the very first message.
- Sounds like a real person starting a chat, not an interview.
- Uses vocabulary, idioms, and references appropriate for ${target}. Avoid wording from other regions or registers.
- Follow the STYLE GUIDANCE in the level block above — that is authoritative on how complex your reply may be.
- Stay 100% in ${targetName}. Do NOT include ${nativeLanguage} translations, glosses, parentheticals, or word-pairings. The learner sees only your ${targetName} output.

Return ONLY the message text in ${targetName}. No JSON, no quotes, no preamble, no formatting.`;

  try {
    const text = (
      await chatText({
        task: "chat_precise",
        label: "converse/start",
        systemPrompt: prompt,
        temperature: 0.7,
      })
    ).trim();
    if (!text) {
      throw new Error("Model returned no usable opener");
    }

    // Resolve target conversation: either reuse the empty one the
    // client created on home-→-chat navigation, or create fresh for the
    // legacy atomic shape.
    let conversationId: number;
    if (existingId !== undefined) {
      const existing = await getConversation(existingId);
      if (!existing || existing.user_id !== user.id) {
        return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
      }
      conversationId = existingId;
      await updateConversationTopic(conversationId, topic.trim());
    } else {
      conversationId = await createConversation(user.id, topic.trim());
    }
    await appendMessage({
      conversationId,
      role: "ai",
      textTarget: text,
      segments: null,
    });

    return NextResponse.json({ conversationId, text });
  } catch (err) {
    console.error("[/api/converse/start]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  });
}
