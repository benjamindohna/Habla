import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildPrompt(
  localVersionEs: string,
  localSegment: string,
  userSegment: string,
  nativeLanguage: string
): string {
  return `You are a friendly and encouraging Spanish tutor. A learner (native language: ${nativeLanguage}) made a mistake in one part of a sentence. Your job is to give a short, clear, specific lesson about that one mistake.

Here is the full correct sentence a native Spanish speaker would say:
"${localVersionEs}"

In that sentence, there is one segment where the learner made a mistake:
- Correct Spanish: "${localSegment}"
- What I said: "${userSegment || "(nothing — I left this out)"}"

Please explain this mistake in ${nativeLanguage}. Cover the following, but keep it concise (3–5 sentences max):

1. What I said and why it doesn't work here.
2. What the correct form is and why a Spanish speaker says it that way.
3. If I used a ${nativeLanguage} word instead of a Spanish one, show the Spanish equivalent with any useful forms (infinitive, gender, plural, common usage).
4. If the mistake is grammatical (wrong verb form, wrong tense, wrong article, wrong agreement), briefly explain the rule in plain terms.

Be direct and specific. Do not re-explain the whole sentence. Do not use markdown. Write in plain text.`;
}

export async function POST(req: NextRequest) {
  try {
    const { localVersionEs, localSegment, userSegment, nativeLanguage = "German" } =
      (await req.json()) as {
        localVersionEs: string;
        localSegment: string;
        userSegment: string;
        nativeLanguage?: string;
      };

    if (!localVersionEs || !localSegment) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: buildPrompt(localVersionEs, localSegment, userSegment, nativeLanguage),
        },
      ],
      temperature: 0.4,
      max_tokens: 300,
    });

    const explanation = completion.choices[0].message.content?.trim() ?? "";
    return NextResponse.json({ explanation });
  } catch (err) {
    console.error("[/api/explain]", err);
    return NextResponse.json({ error: "Explanation failed" }, { status: 500 });
  }
}
