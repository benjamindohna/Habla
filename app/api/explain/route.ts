import { NextRequest, NextResponse } from "next/server";
import { chatText } from "@/lib/llm";
import { DEFAULT_TARGET, describeTargetLanguage } from "@/lib/targetLanguage";

/**
 * Compute (min, max) sentence length range based on the local segment's
 * word count. Short segments deserve quick explanations; longer ones
 * need more room. Pure deterministic, no LLM call.
 */
function sentenceLimits(localSegment: string): { min: number; max: number } {
  const words = localSegment.trim().split(/\s+/).filter(Boolean).length;
  if (words <= 3) return { min: 1, max: 6 };
  if (words <= 6) return { min: 1, max: 8 };
  return { min: 4, max: 12 };
}

function buildPromptV1(
  localVersionTarget: string,
  localSegment: string,
  userSegment: string,
  nativeLanguage: string,
): string {
  const target = describeTargetLanguage(DEFAULT_TARGET);
  const targetName = DEFAULT_TARGET.language;
  return `You are a helpful ${target} tutor. A learner is studying ${targetName} and wants feedback on a specific part of a sentence.

Full sentence (perfect ${target}): "${localVersionTarget}"
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

function buildPromptV2(
  localVersionTarget: string,
  localSegment: string,
  userSegment: string,
  nativeLanguage: string,
): string {
  const target = describeTargetLanguage(DEFAULT_TARGET);
  const targetName = DEFAULT_TARGET.language;
  const { min, max } = sentenceLimits(localSegment);
  const wordCount = localSegment.trim().split(/\s+/).filter(Boolean).length;
  return `You are a helpful ${target} tutor. A learner is studying ${targetName} and wants feedback on a specific part of a sentence.

Full sentence (perfect ${target}): "${localVersionTarget}"
Correct version of this segment: "${localSegment}" (${wordCount} word${wordCount === 1 ? "" : "s"})
What the learner said: "${userSegment || "(nothing — this part was left out)"}"

Important context about how this learner speaks:
- The learner intentionally falls back to ${nativeLanguage} for words or phrases they don't yet know in ${targetName}. When the learner used a ${nativeLanguage} word, treat it as a request to learn the ${targetName} equivalent — just teach them the ${targetName}.
- NEVER point out that the word is ${nativeLanguage}. The learner already knows that. Do NOT write phrases like "X is ${nativeLanguage}", "in your language you said X", "you used the ${nativeLanguage} word", or anything similar. Skip the meta-commentary entirely and go straight to the ${targetName} explanation.

Provide feedback in ${nativeLanguage} to help the learner understand and improve. Cover whatever is most useful — vocabulary, grammar, usage, word forms, or anything else relevant. Use **bold** for ${targetName} words, key terms, and important concepts. Use line breaks between distinct points. Examples and corrections must use ${target} (the variety the learner is studying).

LENGTH: ${min} to ${max} sentences. The segment is ${wordCount} word${wordCount === 1 ? "" : "s"} long — calibrate accordingly. Single-word fixes need 1-2 sentences; longer multi-word constructions may need more so you can cover both vocabulary and grammar. Never exceed ${max} sentences.

Rules:
- Start directly with the feedback. No preamble, no "of course", no "great question", no meta-comments.
- Every sentence should add something concrete. Cut anything vague or filler.

Worked example (illustrative — Spanish target, German native; pattern applies to any language pair):
  Segment: "campo de fútbol"
  Learner said: "Fußballfeld"
  Feedback:
    Auf Spanisch sagt man **"campo de fútbol"** — wörtlich „Feld des Fußballs".
    Die Konstruktion **Substantiv + de + Substantiv** ist im Spanischen sehr häufig (z.B. **"pelota de tenis"**, **"libro de historia"**).`;
}

export async function POST(req: NextRequest) {
  try {
    const {
      localVersionTarget,
      localSegment,
      userSegment,
      nativeLanguage = "German",
      explainMini,
      improvedExplainPrompt,
    } = (await req.json()) as {
      localVersionTarget: string;
      localSegment: string;
      userSegment: string;
      nativeLanguage?: string;
      /** undefined = use server default (chat_light). Playground sends
       *  explicit boolean via the model toggle. */
      explainMini?: boolean;
      /** undefined = use server default (V2). Playground sends explicit
       *  boolean via the prompt-version toggle. */
      improvedExplainPrompt?: boolean;
    };

    if (!localVersionTarget || !localSegment) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Production defaults: chat_light (mini) + V2 prompt. Playground
    // overrides via explicit booleans through the prop chain.
    const task = explainMini === false ? "chat_precise" : "chat_light";
    const useV2 = improvedExplainPrompt !== false;
    const buildPrompt = useV2 ? buildPromptV2 : buildPromptV1;
    // V2 maxTokens scales with the prompt's sentence range so longer
    // explanations don't get truncated mid-sentence.
    const { max } = sentenceLimits(localSegment);
    const maxTokens = useV2 ? Math.max(250, max * 50) : 250;
    const explanation = await chatText({
      task,
      label: `explain/${task}${useV2 ? "/v2" : ""}`,
      userPrompt: buildPrompt(localVersionTarget, localSegment, userSegment, nativeLanguage),
      temperature: 0.4,
      maxTokens,
    });
    return NextResponse.json({ explanation });
  } catch (err) {
    console.error("[/api/explain]", err);
    return NextResponse.json({ error: "Explanation failed" }, { status: 500 });
  }
}
