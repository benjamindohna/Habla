import { NextRequest, NextResponse } from "next/server";
import { chatText } from "@/lib/llm";
import { DEFAULT_TARGET, describeTargetLanguage } from "@/lib/targetLanguage";

function buildPrompt(
  localVersionEs: string,
  localSegment: string,
  userSegment: string,
  nativeLanguage: string
): string {
  const target = describeTargetLanguage(DEFAULT_TARGET);
  const targetName = DEFAULT_TARGET.language;
  return `You are a helpful ${target} tutor. A learner is studying ${targetName} and wants feedback on a specific part of a sentence.

Full sentence (perfect ${target}): "${localVersionEs}"
Correct version of this segment: "${localSegment}"
What the learner said: "${userSegment || "(nothing — this part was left out)"}"

Important context about how this learner speaks:
- The learner intentionally falls back to ${nativeLanguage} for words or phrases they don't yet know in ${targetName}. When the learner used a ${nativeLanguage} word, treat it as a request to learn the ${targetName} equivalent — just teach them the ${targetName}.
- NEVER point out that the word is ${nativeLanguage}. The learner already knows that. Do NOT write phrases like "X is ${nativeLanguage}", "in your language you said X", "you used the ${nativeLanguage} word", or anything similar. Skip the meta-commentary entirely and go straight to the ${targetName} explanation.

Provide feedback in ${nativeLanguage} to help the learner understand and improve. Cover whatever is most useful — vocabulary, grammar, usage, word forms, or anything else relevant. Use **bold** for ${targetName} words, key terms, and important concepts. Use line breaks between distinct points. Examples and corrections must use ${target} (the variety the learner is studying).

Rules for your response:
- Start directly with the feedback. No preamble, no "of course", no "great question", no meta-comments.
- Be concise. Use as few sentences as the complexity warrants — simple cases get 1–2 sentences, complex ones up to 6. Never exceed 6 sentences.
- Every sentence should add something concrete. Cut anything vague or filler.`;
}

export async function POST(req: NextRequest) {
  try {
    const {
      localVersionEs,
      localSegment,
      userSegment,
      nativeLanguage = "German",
      useMini = false,
    } = (await req.json()) as {
      localVersionEs: string;
      localSegment: string;
      userSegment: string;
      nativeLanguage?: string;
      /** Test-only flag from /playground/correct-test: forces chat_light. */
      useMini?: boolean;
    };

    if (!localVersionEs || !localSegment) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const task = useMini === true ? "chat_light" : "chat_precise";
    const explanation = await chatText({
      task,
      label: `explain/${task}`,
      userPrompt: buildPrompt(localVersionEs, localSegment, userSegment, nativeLanguage),
      temperature: 0.4,
      maxTokens: 250,
    });
    return NextResponse.json({ explanation });
  } catch (err) {
    console.error("[/api/explain]", err);
    return NextResponse.json({ error: "Explanation failed" }, { status: 500 });
  }
}
