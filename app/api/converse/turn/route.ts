import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { DEFAULT_TARGET, describeTargetLanguage } from "@/lib/targetLanguage";
import {
  appendMessage,
  getConversation,
  getMessages,
  type Segment,
} from "@/lib/conversations";
import type { Pair } from "@/types/correction";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const user = getUserById(session.userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    conversationId?: number;
    userTextEs?: string;
    userRaw?: string;
    segments?: Pair[];
  };
  const { conversationId, userTextEs, userRaw, segments } = body;

  if (typeof conversationId !== "number" || !conversationId) {
    return NextResponse.json({ error: "conversationId required" }, { status: 400 });
  }
  if (typeof userTextEs !== "string" || !userTextEs.trim()) {
    return NextResponse.json({ error: "userTextEs required" }, { status: 400 });
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
    textEs: userTextEs.trim(),
    userRaw: userRaw?.trim() || null,
    segments: segments ?? null,
  });

  // Rebuild the message history for the model. AI sees the corrected text_es
  // for user turns (not the raw transcript) so it engages with what the user
  // *meant*, not what they accidentally said.
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

ALSO segment the reply for tap-to-translate. Return an ordered array of segments whose "es" fields, concatenated in order, exactly reconstruct the reply.
- Each meaningful word or multi-word unit gets a segment with a "native" field containing the literal ${nativeLanguage} translation in the SAME grammatical form ("sería" → "wäre", not "sein"). Do NOT lemmatize.
- Group multi-word idioms, fixed expressions, and tightly-bound collocations as ONE segment with one translation. Examples in ${targetName}: "buenos días", "tener ganas", "darse cuenta", "echar de menos", "por favor".
- Punctuation, opening question/exclamation marks, and standalone whitespace go in segments WITHOUT a "native" field — they're not tappable.
- The segments must reconstruct the message exactly. If you join all "es" values back together, you must get the original "text".

Return ONLY valid JSON:
{
  "text": "<your next message in ${targetName}>",
  "segments": [
    { "es": "<token>", "native": "<${nativeLanguage} translation>" },
    { "es": "<punctuation or whitespace>" }
  ]
}`;

  // Build message array: system + alternating turns from history.
  const messages: { role: "system" | "assistant" | "user"; content: string }[] = [
    { role: "system", content: systemPrompt },
  ];
  for (const m of history) {
    messages.push({
      role: m.role === "ai" ? "assistant" : "user",
      content: m.textEs,
    });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages,
      temperature: 0.7,
    });

    const raw = completion.choices[0].message.content ?? "{}";
    const parsed = JSON.parse(raw) as { text?: unknown; segments?: unknown };
    if (typeof parsed.text !== "string" || !parsed.text.trim()) {
      throw new Error("Model returned no usable reply");
    }

    const segments: Segment[] | null = Array.isArray(parsed.segments)
      ? (parsed.segments as Array<{ es?: unknown; native?: unknown }>)
          .filter((s) => s != null && typeof s.es === "string")
          .map((s) => {
            const out: Segment = { es: s.es as string };
            if (typeof s.native === "string" && s.native.trim()) {
              out.native = s.native.trim();
            }
            return out;
          })
      : null;

    appendMessage({
      conversationId,
      role: "ai",
      textEs: parsed.text.trim(),
      segments,
    });

    return NextResponse.json({ text: parsed.text.trim(), segments });
  } catch (err) {
    console.error("[/api/converse/turn]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
