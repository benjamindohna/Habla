import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { intendedMeaning } = (await req.json()) as {
      intendedMeaning: string;
    };

    if (!intendedMeaning?.trim()) {
      return NextResponse.json({ error: "No intended meaning provided" }, { status: 400 });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a native Spanish speaker. Your only job is to express the given meaning in natural, everyday Spanish exactly as an average local Spaniard would say it in casual conversation.

Rules:
- Not textbook Spanish. Not overly formal. Natural, local, everyday speech.
- Do not add or remove meaning — express exactly what is given, nothing more.
- Always write numbers as words, never as digits.
- The sentence must end with appropriate punctuation (period, question mark, or exclamation mark).

Return ONLY valid JSON:
{ "local_version_es": "string" }`,
        },
        { role: "user", content: intendedMeaning },
      ],
      temperature: 0.2,
    });

    const raw = completion.choices[0].message.content ?? "{}";
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    console.error("[/api/localize]", err);
    return NextResponse.json({ error: "Localization failed" }, { status: 500 });
  }
}
