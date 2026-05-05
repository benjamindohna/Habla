import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { DEFAULT_TARGET, describeTargetLanguage } from "@/lib/targetLanguage";
import { appendMessage, createConversation, type Segment } from "@/lib/conversations";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

  const prompt = `You are opening a conversation in ${target} with a learner whose native language is ${nativeLanguage}.

Topic: "${topic.trim()}"
Learner level: ${user.level}/100 (0 = absolute beginner, 100 = sophisticated native speaker).

Write a single opening message in ${target} that:
- Is genuinely interesting and inviting — not a generic "Do you like X?".
- Asks a thoughtful, specific question about the topic that invites a real opinion, story, or take.
- Matches the learner's level (aim a few notches above to stretch them, but stay understandable).
- Is short and conversational — one or two sentences. Not a lecture.
- Sounds like a real person starting a chat, not an interview.
- Uses vocabulary, idioms, and references appropriate for ${target}. Avoid wording from other regions or registers.

ALSO segment the message for tap-to-translate. Return an ordered array of segments whose "es" fields, concatenated in order, exactly reconstruct the message.
- Each meaningful word or multi-word unit gets a segment with a "native" field containing the literal ${nativeLanguage} translation in the SAME grammatical form ("sería" → "wäre", not "sein"). Do NOT lemmatize.
- Group multi-word idioms, fixed expressions, and tightly-bound collocations as ONE segment with one translation. Examples in ${targetName}: "buenos días", "tener ganas", "darse cuenta", "echar de menos", "por favor".
- Punctuation, opening question/exclamation marks, and standalone whitespace go in segments WITHOUT a "native" field — they're not tappable.
- The segments must reconstruct the message exactly. Test mentally: if you join all "es" values back together, do you get the original "text"? If not, fix it.

Return ONLY valid JSON:
{
  "text": "<the opening message in ${target}>",
  "segments": [
    { "es": "<token>", "native": "<${nativeLanguage} translation>" },
    { "es": "<punctuation or whitespace>" }
  ]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: prompt }],
      temperature: 0.7,
    });

    const raw = completion.choices[0].message.content ?? "{}";
    const parsed = JSON.parse(raw) as { text?: unknown; segments?: unknown };
    if (typeof parsed.text !== "string" || !parsed.text.trim()) {
      throw new Error("Model returned no usable opener");
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

    // Persist: create the conversation row and store the opener as the first
    // message so future /turn calls can rebuild context from the DB.
    const conversationId = createConversation(user.id, topic.trim());
    appendMessage({
      conversationId,
      role: "ai",
      textEs: parsed.text.trim(),
      segments,
    });

    return NextResponse.json({
      conversationId,
      text: parsed.text.trim(),
      segments,
    });
  } catch (err) {
    console.error("[/api/converse/start]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
