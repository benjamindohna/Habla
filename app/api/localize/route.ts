import { NextRequest, NextResponse } from "next/server";
import { chatJSON } from "@/lib/llm";
import { DEFAULT_TARGET, describeTargetLanguage } from "@/lib/targetLanguage";

type Style = "natural" | "transcript_aware";

function naturalPrompt(nativeLanguage: string): string {
  const target = describeTargetLanguage(DEFAULT_TARGET);
  const targetName = DEFAULT_TARGET.language;
  return `You are a native ${targetName} speaker. Your job is to express the given meaning in natural, ${target} as it would be spoken in casual conversation.

Rules:
- Match the variety: ${target}. Vocabulary, idioms, named entities, and register must fit this variety. Do not drift to other regions or registers.
- Preserve EVERY clause from the meaning, even short tags or seemingly redundant phrases. Use multiple sentences if needed.
- The output is in ${targetName}. The input meaning is in ${nativeLanguage}.
- Always write numbers as words, never as digits.
- End with appropriate punctuation.

Return ONLY valid JSON:
{ "local_version_es": "string" }`;
}

function transcriptAwarePrompt(nativeLanguage: string): string {
  const target = describeTargetLanguage(DEFAULT_TARGET);
  const targetName = DEFAULT_TARGET.language;
  return `You are a ${targetName}-language correction engine for a learner.

You receive two inputs:
- TRANSCRIPT: what the learner actually said. May mix ${targetName} and ${nativeLanguage}, may have grammar errors or unnatural phrasing.
- INTENT: what they meant to say, expressed in ${nativeLanguage}.

Your job: produce one ${target} sentence (or sentences, if the learner spoke in multiple clauses) that captures the INTENT and that the learner can use as a corrected reference.

CRITICAL: Stay as close to the TRANSCRIPT as possible.
- Where the TRANSCRIPT is already correct, natural ${target}, KEEP THE LEARNER'S EXACT WORDS. Do not rewrite correct ${targetName} into synonyms or rearrange word order for stylistic reasons.
- Only change parts that are wrong, unnatural, in ${nativeLanguage}, or in the wrong ${targetName} variety.
- The goal is a corrected version, not a rewritten version. If the learner's phrasing is acceptable for ${target}, leave it alone.

Other rules:
- Match the variety: ${target}. Replace vocabulary or idioms from other regions/registers with their ${target} equivalents.
- Preserve EVERY clause from INTENT. If the learner said multiple clauses (even seemingly redundant ones, like a softener at the end), include all of them.
- Always write numbers as words, never as digits.
- End with appropriate punctuation.

Return ONLY valid JSON:
{ "local_version_es": "string" }`;
}

export async function POST(req: NextRequest) {
  try {
    const {
      intendedMeaning,
      transcript,
      nativeLanguage = "German",
      style = "natural",
    } = (await req.json()) as {
      intendedMeaning: string;
      transcript?: string;
      nativeLanguage?: string;
      style?: Style;
    };

    if (!intendedMeaning?.trim()) {
      return NextResponse.json({ error: "No intended meaning provided" }, { status: 400 });
    }

    const useTranscript = style === "transcript_aware" && transcript?.trim();

    const systemPrompt = useTranscript
      ? transcriptAwarePrompt(nativeLanguage)
      : naturalPrompt(nativeLanguage);

    const userContent = useTranscript
      ? `TRANSCRIPT: "${transcript!.trim()}"\nINTENT: "${intendedMeaning}"`
      : intendedMeaning;

    const result = await chatJSON({
      task: "chat_precise",
      label: "localize",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/localize]", err);
    return NextResponse.json({ error: "Localization failed" }, { status: 500 });
  }
}
