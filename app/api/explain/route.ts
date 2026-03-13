import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildPrompt(
  localVersionEs: string,
  localSegment: string,
  userSegment: string,
  nativeLanguage: string
): string {
  return `You are a helpful Spanish tutor. A learner is studying Spanish and wants feedback on a specific part of a sentence.

Full sentence (perfect Spanish): "${localVersionEs}"
Correct version of this segment: "${localSegment}"
What the learner said: "${userSegment || "(nothing — this part was left out)"}"

Provide feedback in ${nativeLanguage} to help the learner understand and improve. Cover whatever is most useful — vocabulary, grammar, usage, word forms, or anything else relevant. Use **bold** for Spanish words, key terms, and important concepts. Use line breaks between distinct points.

Rules for your response:
- Start directly with the feedback. No preamble, no "of course", no "great question", no meta-comments.
- Be concise. Use as few sentences as the complexity warrants — simple cases get 1–2 sentences, complex ones up to 6. Never exceed 6 sentences.
- Every sentence should add something concrete. Cut anything vague or filler.`;
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
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: buildPrompt(localVersionEs, localSegment, userSegment, nativeLanguage),
        },
      ],
      temperature: 0.4,
      max_tokens: 250,
    });

    const explanation = completion.choices[0].message.content?.trim() ?? "";
    return NextResponse.json({ explanation });
  } catch (err) {
    console.error("[/api/explain]", err);
    return NextResponse.json({ error: "Explanation failed" }, { status: 500 });
  }
}
