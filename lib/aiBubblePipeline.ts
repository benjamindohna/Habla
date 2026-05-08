// Two-call pipeline for AI-bubble text + tap-to-translate segments.
//
// Replaces the single-prompt "generate text + segment + translate in one
// shot" approach used today by /api/converse/start and /api/converse/turn.
// The single prompt overloads the model and produces drift on segmentation
// (compound tenses split, idioms broken up, isolated translations like
// haya → "Habe").
//
// New shape:
//   Call A (generateAIOpener) — produce only the AI's text. Pure
//   conversational generation, no segmentation rules competing with it.
//
//   Call B (segmentAndAlign) — take the generated text, produce a full
//   idiomatic native translation, then segment the target text and align
//   each segment to a piece of that translation. Because every native
//   fragment is anchored in a real grammatical sentence, isolated bad
//   translations disappear: haya impresionado naturally maps to
//   "beeindruckt hat" (compound), not "Habe + impressed".

import { chatJSON, chatText } from "./llm";
import { DEFAULT_TARGET, describeTargetLanguage } from "./targetLanguage";
import type { Segment } from "@/types/segment";

export interface AIBubblePipelineResult {
  text: string;
  native_translation: string;
  segments: Segment[];
}

// ── Call A — text only ───────────────────────────────────────────────────

export async function generateAIOpener(args: {
  topic: string;
  level: number;
  nativeLanguage: string;
}): Promise<string> {
  const target = describeTargetLanguage(DEFAULT_TARGET);
  const targetName = DEFAULT_TARGET.language;
  const targetBand = `${args.level + 5}-${args.level + 10}`;

  const prompt = `You are a native ${target} speaker opening a casual conversation about a topic with a learner whose native language is ${args.nativeLanguage}.

Topic: "${args.topic}"
Learner level: ${args.level}/100 (0 = absolute beginner, 100 = sophisticated native speaker).
Aim at roughly level ${targetBand} — slightly above the learner's level to stretch them while staying understandable.

Write a single opening message in ${target} that:
- Is genuinely interesting and inviting — not a generic "Do you like X?".
- Asks a thoughtful, specific question about the topic that invites a real opinion, story, or take.
- Is short and conversational — one to three sentences. Not a lecture.
- Sounds like a real person starting a chat, not an interview.
- Uses vocabulary, idioms, and references appropriate for ${target}. Avoid wording from other regions or registers.

Return ONLY the message text in ${targetName}. No JSON, no quotes, no preamble, no formatting.`;

  return chatText({
    task: "chat_light",
    label: "playground/openerA",
    systemPrompt: prompt,
    temperature: 0.7,
  });
}

// ── Call B — translate, segment, align ───────────────────────────────────

export async function segmentAndAlign(args: {
  text: string;
  nativeLanguage: string;
}): Promise<{ native_translation: string; segments: Segment[] }> {
  const target = describeTargetLanguage(DEFAULT_TARGET);
  const targetName = DEFAULT_TARGET.language;

  const prompt = `You are a translation-and-alignment engine for language learning. The learner is studying ${target}; their native language is ${args.nativeLanguage}.

You receive ONE message in ${targetName}. Do BOTH:

1. Produce a complete idiomatic ${args.nativeLanguage} translation of the message — how a native ${args.nativeLanguage} speaker would actually phrase it, not a word-for-word translation. Preserve every clause and nuance.

2. Segment the ${targetName} message and align each segment to its corresponding fragment of your ${args.nativeLanguage} translation. The ${args.nativeLanguage} fragments may appear in a different word order than the ${targetName} segments — that is fine; alignment is by meaning, not position.

HOW TO SEGMENT
- Each segment is either: a single content word (verb, noun, adjective, …), a single function word (article, preposition, conjunction), a multi-word unit that MUST stay together, or punctuation.
- Multi-word units that MUST stay together as ONE segment:
  • Compound tenses: haber + past participle (he visto, había dicho, haya impresionado), estar + gerund (está hablando), ir a + infinitive (voy a hacer), modal periphrases (tener que ir, hay que hacerlo).
  • Idioms / fixed expressions: tener ganas, darse cuenta, echar de menos, por ejemplo, en cambio, sin embargo.
  • Multi-word named entities: Estados Unidos, Real Madrid, América Latina.
- Inverted question/exclamation marks (¿, ¡) and other punctuation are their OWN segments with NO native field.
- Whitespace between segments does not need its own segment — the renderer handles spacing. But if you need to keep an internal space (e.g. inside a multi-word segment), include it in the "es" string.
- The concatenation of all "es" fields, joined back in order, MUST exactly reconstruct the input (modulo whitespace between segments).

HOW TO ALIGN
- For each ${targetName} segment, take the corresponding fragment of your ${args.nativeLanguage} translation. Use the SAME grammatical form as it appears in the translation — do NOT lemmatise, do NOT normalise.
- Multi-word ${targetName} segments map to whatever ${args.nativeLanguage} fragment expresses the same meaning, even if it is also multiple words ("te haya impresionado" → "dich beeindruckt hat").
- Some ${targetName} segments may have no direct ${args.nativeLanguage} counterpart (pro-drop subjects, expletive pronouns). Leave their "native" empty in that case.
- Punctuation segments have NO native field at all (omit it, do not pass an empty string).

WORKED EXAMPLE (target Spanish, native German)

Target: "¿Tienes algún diseño que te haya impresionado?"
Native translation: "Hast du ein Design, das dich beeindruckt hat?"
Segments:
  { "es": "¿" }
  { "es": "Tienes", "native": "Hast du" }
  { "es": "algún", "native": "ein" }
  { "es": "diseño", "native": "Design" }
  { "es": "que", "native": "das" }
  { "es": "te haya impresionado", "native": "dich beeindruckt hat" }
  { "es": "?" }

WORKED EXAMPLE (idiom)

Target: "No tengo ganas de salir esta noche."
Native translation: "Ich habe heute Abend keine Lust auszugehen."
Segments:
  { "es": "No", "native": "keine" }
  { "es": "tengo ganas", "native": "habe Lust" }
  { "es": "de", "native": "zu" }
  { "es": "salir", "native": "ausgehen" }
  { "es": "esta noche", "native": "heute Abend" }
  { "es": "." }

Now process the actual input.

${targetName} message:
"${args.text}"

Return ONLY valid JSON:
{
  "native_translation": "<full idiomatic ${args.nativeLanguage} translation>",
  "segments": [
    { "es": "<target segment>", "native": "<corresponding ${args.nativeLanguage} fragment>" },
    { "es": "<punctuation>" }
  ]
}`;

  const parsed = await chatJSON<{
    native_translation?: unknown;
    segments?: unknown;
  }>({
    task: "chat_light",
    label: "playground/segmentB",
    systemPrompt: prompt,
    temperature: 0.2,
  });

  const native_translation =
    typeof parsed.native_translation === "string" ? parsed.native_translation.trim() : "";

  const segments: Segment[] = Array.isArray(parsed.segments)
    ? (parsed.segments as Array<{ es?: unknown; native?: unknown }>)
        .filter((s) => s != null && typeof s.es === "string")
        .map((s) => {
          const out: Segment = { es: s.es as string };
          if (typeof s.native === "string" && s.native.trim()) {
            out.native = s.native.trim();
          }
          return out;
        })
    : [];

  return { native_translation, segments };
}

// ── Orchestrator — call A then B ─────────────────────────────────────────

export async function generateAndSegmentOpener(args: {
  topic: string;
  level: number;
  nativeLanguage: string;
}): Promise<AIBubblePipelineResult> {
  const text = await generateAIOpener(args);
  const { native_translation, segments } = await segmentAndAlign({
    text,
    nativeLanguage: args.nativeLanguage,
  });
  return { text, native_translation, segments };
}
