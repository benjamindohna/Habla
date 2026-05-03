import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";

// Future: per-user setting. For now the app is Spanish-only.
const TARGET_LANGUAGE = "Spanish";

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

  const prompt = `You are opening a conversation in ${TARGET_LANGUAGE} with a learner.

Topic: "${topic.trim()}"
Learner level: ${user.level}/100 (0 = absolute beginner, 100 = sophisticated native speaker).

Write a single opening message in ${TARGET_LANGUAGE} that:
- Is genuinely interesting and inviting — not a generic "Do you like X?".
- Asks a thoughtful, specific question about the topic that invites a real opinion, story, or take.
- Matches the learner's level (aim a few notches above to stretch them, but stay understandable).
- Is short and conversational — one or two sentences. Not a lecture.
- Sounds like a real person starting a chat, not an interview.

Return ONLY valid JSON:
{ "text": "<the opening message in ${TARGET_LANGUAGE}>" }`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: prompt }],
      temperature: 0.7,
    });

    const raw = completion.choices[0].message.content ?? "{}";
    const parsed = JSON.parse(raw) as { text?: unknown };
    if (typeof parsed.text !== "string" || !parsed.text.trim()) {
      throw new Error("Model returned no usable opener");
    }

    return NextResponse.json({ text: parsed.text.trim() });
  } catch (err) {
    console.error("[/api/converse/start]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
