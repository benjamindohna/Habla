import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildPrompt(
  localVersionEs: string,
  localSegment: string,
  userSegment: string,
  nativeLanguage: string
): string {
  return `You are a calm, encouraging Spanish tutor. A learner (native language: ${nativeLanguage}) used a different word or form in one segment of a sentence. Your job is to give a brief, neutral note — not a correction lecture.

Full sentence in natural Spanish: "${localVersionEs}"
Correct segment: "${localSegment}"
What the learner said: "${userSegment || "(nothing — left this out)"}"

Determine which case applies and respond accordingly in ${nativeLanguage}:

CASE A — The learner used one or more ${nativeLanguage} words (or non-Spanish words) instead of Spanish ones:
Do NOT frame this as a mistake. It is completely normal not to know every word yet. For EVERY non-Spanish word the learner used in this segment, give a brief entry: the infinitive (for verbs) or base form (for nouns/adjectives), its basic translation(s), and the specific form used in this sentence (e.g. conjugation, gender, plural) if relevant. If there are multiple such words, cover all of them — one short entry each. Keep the total brief.
Example tone: "Spielen — to play. Here: jugar. Used here as juega (third person singular, present). Freunde — friends. Here: amigos."

CASE B — The learner used Spanish but with a grammatical error (wrong verb form, wrong tense, wrong article, wrong agreement, wrong word order, etc.):
Address only the specific grammatical point. Be brief and direct. 1–2 sentences, 3 only if truly necessary.

Do not moralize, do not say "you made a mistake", do not re-explain the whole sentence. Write in plain text, no markdown.`;
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
      max_tokens: 150,
    });

    const explanation = completion.choices[0].message.content?.trim() ?? "";
    return NextResponse.json({ explanation });
  } catch (err) {
    console.error("[/api/explain]", err);
    return NextResponse.json({ error: "Explanation failed" }, { status: 500 });
  }
}
