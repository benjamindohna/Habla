import { NextRequest, NextResponse } from "next/server";
import { chatText, type ChatMessage } from "@/lib/llm";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { DEFAULT_TARGET, describeTargetLanguage } from "@/lib/targetLanguage";
import {
  appendMessage,
  getConversation,
  getMessages,
} from "@/lib/conversations";
import type { Pair } from "@/types/correction";

/**
 * AI reply on each user turn. Plain-text only — the client tokenises
 * the reply word-by-word and fires per-tap translation + vocab save
 * on tap. AI side stores no segments.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const user = getUserById(session.userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    conversationId?: number;
    userTextTarget?: string;
    userRaw?: string;
    segments?: Pair[];
  };
  const { conversationId, userTextTarget, userRaw, segments } = body;

  if (typeof conversationId !== "number" || !conversationId) {
    return NextResponse.json({ error: "conversationId required" }, { status: 400 });
  }
  if (typeof userTextTarget !== "string" || !userTextTarget.trim()) {
    return NextResponse.json({ error: "userTextTarget required" }, { status: 400 });
  }

  const conversation = getConversation(conversationId);
  if (!conversation || conversation.user_id !== user.id) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Persist the user turn first — even if AI generation later fails, the
  // user's message is recorded so the conversation can resume.
  appendMessage({
    conversationId,
    role: "user",
    textTarget: userTextTarget.trim(),
    userRaw: userRaw?.trim() || null,
    segments: segments ?? null,
  });

  // Rebuild the message history for the model. AI sees the corrected
  // target-language text for user turns (not the raw transcript) so it
  // engages with what the user *meant*, not what they accidentally said.
  const history = getMessages(conversationId);

  const target = describeTargetLanguage(DEFAULT_TARGET);
  const targetName = DEFAULT_TARGET.language;
  const nativeLanguage = user.nativeLanguage;
  const targetBand = `${user.level + 5}-${user.level + 10}`;

  const systemPrompt = `You are a native ${target} speaker having a casual conversation with a language learner whose native language is ${nativeLanguage}.

Topic of the conversation: "${conversation.topic}"
Learner level: ${user.level}/100 (0 = absolute beginner, 100 = sophisticated native speaker).
Aim your replies at roughly level ${targetBand} — slightly above the learner's level to stretch them while staying understandable.

Behave like a real chat partner:
- Engage with what the learner just said. React, agree, disagree, share your own take, or ask a follow-up question.
- Keep replies short — usually one to three sentences. Conversational, not a lecture.
- Don't quiz the learner or test them. Just talk like a friend would.
- Don't comment on the learner's language, grammar, vocabulary, or accent. They have a separate correction system handling that. Just respond to the content.
- Stay in ${target}: use vocabulary, idioms, named entities, and register that fit this variety. Do not drift to other regions or registers.

Return ONLY the reply text in ${targetName}. No JSON, no quotes, no preamble, no formatting.`;

  // Build message array: system + alternating turns from history.
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
  ];
  for (const m of history) {
    messages.push({
      role: m.role === "ai" ? "assistant" : "user",
      content: m.textTarget,
    });
  }

  try {
    const text = (
      await chatText({
        task: "chat_light",
        label: "converse/turn",
        messages,
        temperature: 0.7,
      })
    ).trim();
    if (!text) {
      throw new Error("Model returned no usable reply");
    }

    appendMessage({
      conversationId,
      role: "ai",
      textTarget: text,
      segments: null,
    });

    return NextResponse.json({ text });
  } catch (err) {
    console.error("[/api/converse/turn]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
