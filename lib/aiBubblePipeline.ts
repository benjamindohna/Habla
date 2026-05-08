// Pipeline helpers for AI-bubble text generation and tap-to-translate.
// Two architectures live here side-by-side so we can compare them in the
// playground without touching the production /api/converse/* routes.
//
// Shared:
//   generateAIOpener — produce only the AI's text. No segmentation, no
//   translation. Cheap, single focus. Used by both architectures.
//
// Architecture 1 — upfront segment + align (one big Call B):
//   segmentAndAlign — take the generated text, produce a full idiomatic
//   native translation, then segment the target text and align each
//   segment to a fragment of that translation.
//   generateAndSegmentOpener — orchestrator: generateAIOpener → segmentAndAlign.
//   Pros: instant tap (everything pre-translated). Cons: every word's
//   translation generated whether tapped or not; one heavy prompt mixing
//   tasks.
//
// Architecture 2 — on-tap, per-word translate (lazy):
//   translateWordInContext — fired only when the user taps a specific
//   word. Inputs: full sentence + tapped word (occurrence marked).
//   Outputs: the contextual segment (word alone, or multi-word unit if
//   it belongs to one) plus the contextually-correct native translation.
//   Pros: only translate what's actually looked up; each call laser-focused.
//   Cons: ~1-2s latency per first tap on a word.

import { chatJSON, chatText } from "./llm";
import { DEFAULT_TARGET, describeTargetLanguage } from "./targetLanguage";
import type { Segment } from "@/types/segment";

// ── Shared: Call A — text only ───────────────────────────────────────────

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
    label: "playground/messageA",
    systemPrompt: prompt,
    temperature: 0.7,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Architecture 1 — upfront segment + align
// ─────────────────────────────────────────────────────────────────────────

export interface AIBubblePipelineResult {
  text: string;
  native_translation: string;
  segments: Segment[];
}

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

// ─────────────────────────────────────────────────────────────────────────
// Architecture 2 — on-tap per-word translate
// ─────────────────────────────────────────────────────────────────────────

/**
 * Word regex. Matches a run of Unicode letters (with optional internal
 * combining marks, apostrophe, hyphen). Stable across client and server
 * so a wordIndex computed in the browser refers to the same occurrence
 * the server marks in the prompt.
 */
export const WORD_REGEX = /[\p{L}][\p{L}\p{M}'-]*/gu;

/**
 * Wrap the wordIndex-th word match in the sentence with markers. Used to
 * disambiguate repeated words (e.g. "el libro y el cuaderno" — which
 * "el" did the learner tap?).
 */
function markWordOccurrence(sentence: string, wordIndex: number): string {
  let i = 0;
  const re = new RegExp(WORD_REGEX.source, WORD_REGEX.flags);
  return sentence.replace(re, (match) => {
    if (i++ === wordIndex) return `«${match}»`;
    return match;
  });
}

export interface WordLookupResult {
  segment: string;
  translation: string;
}

export async function translateWordInContext(args: {
  sentence: string;
  word: string;
  wordIndex: number;
  nativeLanguage: string;
}): Promise<WordLookupResult> {
  const target = describeTargetLanguage(DEFAULT_TARGET);
  const targetName = DEFAULT_TARGET.language;
  const marked = markWordOccurrence(args.sentence, args.wordIndex);

  const prompt = `You are a translation assistant for a language learner studying ${target}. Their native language is ${args.nativeLanguage}.

The learner has tapped a single word in a ${targetName} sentence because they don't understand it. The tapped word is wrapped in «guillemets» so you know exactly which occurrence they mean (it may appear multiple times in the sentence).

TASK 1 — DECIDE THE SEGMENT (target-language side)
Decide whether the tapped word stands ALONE or belongs to a multi-word unit. Group it with neighbouring words when:
- The word is an article ("el", "la", "los", "las", "un", "una", "unos", "unas") and a noun follows → segment = article + noun ("el libro").
- The word is part of a COMPOUND TENSE: haber + past participle (he visto, había dicho, haya impresionado), estar + gerund (está hablando), ir a + infinitive (voy a hacer), modal periphrases (tener que ir, hay que hacerlo). Include any clitic object pronouns attached to the verbal complex (me, te, lo, la, le, nos, os, los, las, les, se). → segment = the whole construction including clitics ("te haya impresionado", "se ha ido").
- The word is part of an IDIOM or fixed expression (tener ganas, darse cuenta, echar de menos, por ejemplo, en cambio, sin embargo). → segment = the whole expression.
- The word is part of a MULTI-WORD NAMED ENTITY (Estados Unidos, Real Madrid, América Latina). → segment = the whole name.
Otherwise: segment = just the tapped word.

The segment MUST contain the tapped word and MUST be a CONTIGUOUS SUBSTRING of the original sentence in the EXACT casing and form it appears (do NOT lemmatise the segment — "comió" stays "comió", "ha jugado" stays "ha jugado"). This "no lemmatising" rule applies ONLY to the target-language segment, NOT to the translation.

TASK 2 — TRANSLATE THE SEGMENT (native-language side)
The translation will be displayed to the learner OUT OF CONTEXT, next to the segment, like a vocab card. It must read like a clean ${args.nativeLanguage} entry that makes sense on its own. The rules are different from Task 1:

- PRESERVE THE CONTEXTUAL MEANING the segment has in this sentence. Many words are ambiguous (banco = bench vs bank; fuego = fire vs passion); pick the sense that fits THIS sentence.
- WRITE NATURAL ${args.nativeLanguage} as it stands alone, NOT a positional copy of the ${targetName} word order. Use standard main-clause word order, not subordinate-clause word order.
- INCLUDE elements ${args.nativeLanguage} requires that ${targetName} omits. Most important: ${targetName} drops subject pronouns (pro-drop) but ${args.nativeLanguage} often needs them for the phrase to feel complete on a vocab card.
- KEEP the tense / aspect / person of the segment so the meaning is equivalent.

Worked examples (target Spanish, native German):

- Tapped "diseño" in "un diseño que me gustó"
  Segment: "diseño" → Translation: "das Design" (German nouns get their article on a vocab card)

- Tapped "ha" in "Cruijff ha jugado en Barcelona"
  Segment: "ha jugado" → Translation: "hat gespielt" (3rd person singular; pronoun optional)

- Tapped "has" in "¿Has visto la película?"
  Segment: "has visto" → Translation: "du hast gesehen" (2nd person singular needs "du" to feel complete)

- Tapped "haya" in "que te haya impresionado"
  Segment: "te haya impresionado" → Translation: "hat dich beeindruckt" (NOT "dich beeindruckt hat" — that is German subordinate-clause word order, wrong as a standalone vocab pair)

- Tapped "voy" in "voy a hacer una llamada"
  Segment: "voy a hacer" → Translation: "ich werde machen" or "ich mache gleich" (1st person singular needs "ich")

- Tapped "tengo" in "no tengo ganas de salir"
  Segment: "tengo ganas" → Translation: "habe Lust" (or "ich habe Lust" — both fine; the idiom in lemma form would be "Lust haben" but here we keep the inflected sense)

- Tapped "comió" in "ayer comió pasta"
  Segment: "comió" → Translation: "aß" or "hat gegessen" (preterit, 3rd person)

- Tapped "Estados" in "Estados Unidos"
  Segment: "Estados Unidos" → Translation: "Vereinigte Staaten"

Sentence: "${args.sentence}"
Sentence with tapped word marked: "${marked}"
Tapped word: "${args.word}"

Return ONLY valid JSON:
{
  "segment": "<the target-language segment, exact form from the sentence>",
  "translation": "<the standalone ${args.nativeLanguage} translation, vocab-card style, contextually correct meaning>"
}`;

  // chat_precise (gpt-4o) for the segment + translate combo: compound-tense
  // detection needs grammatical lookahead (auxiliary → participle) that mini
  // does not do reliably. See "te haya" / "du hat" miscut for the symptom.
  const parsed = await chatJSON<{ segment?: unknown; translation?: unknown }>({
    task: "chat_precise",
    label: "playground/translateWord",
    systemPrompt: prompt,
    temperature: 0.2,
  });

  const segment =
    typeof parsed.segment === "string" && parsed.segment.trim()
      ? parsed.segment.trim()
      : args.word;
  const translation =
    typeof parsed.translation === "string" ? parsed.translation.trim() : "";

  return { segment, translation };
}
