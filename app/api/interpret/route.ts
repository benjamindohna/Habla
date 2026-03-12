import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { transcript, nativeLanguage = "German" } = (await req.json()) as {
      transcript: string;
      nativeLanguage?: string;
    };

    if (!transcript?.trim()) {
      return NextResponse.json({ error: "No transcript provided" }, { status: 400 });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a bilingual interpretation assistant. A language learner is trying to speak Spanish but may mix in their native language (${nativeLanguage}) and may have grammar mistakes or unnatural phrasing.

Read the transcript and output what the person most likely intended to say. Write a single fluent sentence in ${nativeLanguage}. Do not produce Spanish output. Just state the intended meaning naturally in ${nativeLanguage}.

If uncertain, choose the most likely interpretation. Be concise — one clear sentence.

Return ONLY valid JSON:
{
  "intended_meaning_native": "string",
  "confidence": "high | medium | low",
  "notes_native": "string"
}

- intended_meaning_native: one fluent sentence in ${nativeLanguage} stating the intended meaning.
- confidence: your confidence in the interpretation.
- notes_native: one short note in ${nativeLanguage} if uncertain; otherwise a brief summary of what the learner was expressing.`,
        },
        { role: "user", content: transcript },
      ],
      temperature: 0.2,
    });

    const raw = completion.choices[0].message.content ?? "{}";
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    console.error("[/api/interpret]", err);
    return NextResponse.json({ error: "Interpretation failed" }, { status: 500 });
  }
}
