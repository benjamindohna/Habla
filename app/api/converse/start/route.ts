import { NextRequest, NextResponse } from "next/server";
import { chatText } from "@/lib/llm";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { DEFAULT_TARGET, describeTargetLanguage } from "@/lib/targetLanguage";
import { appendMessage, createConversation } from "@/lib/conversations";

/**
 * Generate the AI's opener for a conversation. Plain-text only — the
 * client tokenises words client-side and fires per-tap translation +
 * vocab save when the user touches a word. See the new vocab save
 * architecture in ROADMAP.md.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const user = getUserById(session.userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const { topic } = (await req.json().catch(() => ({}))) as { topic?: string };
  if (!topic || typeof topic !== "string" || !topic.trim()) {
    return NextResponse.json({ error: "topic required" }, { status: 400 });
  }

  const target = describeTargetLanguage(DEFAULT_TARGET);
  const targetName = DEFAULT_TARGET.language;
  const nativeLanguage = user.nativeLanguage;
  const targetBand = `${user.level + 5}-${user.level + 10}`;

  const prompt = `You are a native ${target} speaker opening a casual conversation about a topic with a learner whose native language is ${nativeLanguage}.

Topic: "${topic.trim()}"
Learner level: ${user.level}/100 (0 = absolute beginner, 100 = sophisticated native speaker).
Aim at roughly level ${targetBand} — slightly above the learner's level to stretch them while staying understandable.

Write a single opening message in ${target} that:
- Is genuinely interesting and inviting — not a generic "Do you like X?".
- Asks a thoughtful, specific question about the topic that invites a real opinion, story, or take.
- Is short and conversational — one to three sentences. Not a lecture.
- Sounds like a real person starting a chat, not an interview.
- Uses vocabulary, idioms, and references appropriate for ${target}. Avoid wording from other regions or registers.

Return ONLY the message text in ${targetName}. No JSON, no quotes, no preamble, no formatting.`;

  try {
    const text = (
      await chatText({
        task: "chat_light",
        label: "converse/start",
        systemPrompt: prompt,
        temperature: 0.7,
      })
    ).trim();
    if (!text) {
      throw new Error("Model returned no usable opener");
    }

    // Persist: create the conversation row and store the opener as the
    // first message. segments_json stays null for AI messages now —
    // the per-word translation is fetched on-demand at tap time.
    const conversationId = createConversation(user.id, topic.trim());
    appendMessage({
      conversationId,
      role: "ai",
      textEs: text,
      segments: null,
    });

    return NextResponse.json({ conversationId, text });
  } catch (err) {
    console.error("[/api/converse/start]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
