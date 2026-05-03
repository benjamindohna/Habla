import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { intendedMeaning, transcript, nativeLanguage = "German" } = (await req.json()) as {
      intendedMeaning: string;
      transcript?: string;
      nativeLanguage?: string;
    };

    if (!intendedMeaning?.trim()) {
      return NextResponse.json({ error: "No intended meaning provided" }, { status: 400 });
    }

    const transcriptLine = transcript?.trim()
      ? `TRANSCRIPT (what the learner actually said): "${transcript.trim()}"`
      : `TRANSCRIPT: (not provided)`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a Spanish-language correction engine for a learner.

You receive two inputs:
- TRANSCRIPT: what the learner actually said. May mix Spanish and ${nativeLanguage}, may have grammar errors or unnatural phrasing.
- INTENT: what they meant to say, expressed in ${nativeLanguage}.

Your job: produce one natural everyday Spanish sentence (or sentences, if the learner spoke in multiple clauses) that captures the INTENT and that the learner can use as a corrected reference.

CRITICAL: Stay as close to the TRANSCRIPT as possible.
- Where the TRANSCRIPT is already correct, natural Spanish, KEEP THE LEARNER'S EXACT WORDS. Do not rewrite correct Spanish into synonyms or rearrange word order for stylistic reasons.
- Only change parts that are wrong, unnatural, or in ${nativeLanguage}.
- The goal is a corrected version, not a rewritten version. If the learner's phrasing is acceptable, leave it alone.

Other rules:
- Natural local Spanish. Not textbook, not overly formal.
- Preserve EVERY clause from INTENT. If the learner said multiple clauses (even seemingly redundant ones, like a softener at the end), include all of them.
- Always write numbers as words, never as digits.
- End with appropriate punctuation.

Return ONLY valid JSON:
{ "local_version_es": "string" }`,
        },
        {
          role: "user",
          content: `${transcriptLine}\nINTENT: "${intendedMeaning}"`,
        },
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
