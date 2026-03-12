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

Please provide helpful feedback in ${nativeLanguage} to help the learner understand and improve their Spanish. Feel free to cover whatever is most useful — vocabulary, grammar rules, usage, word forms, cultural context, or anything else that helps them grasp the difference and learn from it.

Use **bold** to highlight Spanish words, key terms, and important concepts. Structure your response with clear line breaks between distinct points.`;
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
      max_tokens: 400,
    });

    const explanation = completion.choices[0].message.content?.trim() ?? "";
    return NextResponse.json({ explanation });
  } catch (err) {
    console.error("[/api/explain]", err);
    return NextResponse.json({ error: "Explanation failed" }, { status: 500 });
  }
}
