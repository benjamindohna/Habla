// Pipeline helpers for AI-bubble text generation and on-tap word lookup.
//
// generateAIOpener — produce only the AI's text. Used by the playground
//   message generator; production uses /api/converse/start directly.
//
// translateWordInContext — fires when the user taps a word. Inputs:
//   full sentence + tapped word (occurrence marked). Outputs: the
//   contextual segment (word alone, or multi-word unit if it belongs to
//   one) plus the contextually-correct native translation, plus the
//   indices of the words that constitute the segment for client-side
//   caching.

import { chatJSON, chatText, type ChatTask } from "./llm";
import { describeTargetLanguage, type TargetLanguageSpec } from "./targetLanguage";
import { describeLevelForPrompt } from "./levels";

// ── Shared: Call A — text only ───────────────────────────────────────────

export async function generateAIOpener(args: {
  topic: string;
  level: number;
  nativeLanguage: string;
  targetLanguage: TargetLanguageSpec;
}): Promise<string> {
  const target = describeTargetLanguage(args.targetLanguage);
  const targetName = args.targetLanguage.language;
  const levelBlock = describeLevelForPrompt(args.level, args.targetLanguage);

  const prompt = `You are a native ${target} speaker opening a casual conversation about a topic with a learner whose native language is ${args.nativeLanguage}.

Topic: "${args.topic}"

${levelBlock}

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
// On-tap per-word translate
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
export function markWordOccurrence(sentence: string, wordIndex: number): string {
  let i = 0;
  const re = new RegExp(WORD_REGEX.source, WORD_REGEX.flags);
  return sentence.replace(re, (match) => {
    if (i++ === wordIndex) return `«${match}»`;
    return match;
  });
}

/**
 * Extract just the words (no punctuation, no whitespace) using the same
 * regex as the client. Index N here refers to the same word as wordIndex N
 * on the client side.
 */
function tokenizeWords(sentence: string): string[] {
  const re = new RegExp(WORD_REGEX.source, WORD_REGEX.flags);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence)) !== null) {
    out.push(m[0]);
  }
  return out;
}

export interface WordLookupResult {
  segment: string;
  translation: string;
  /** 0-indexed positions of the words that constitute this segment. The
   *  tapped word's index is always included. Used by the client to cache
   *  the result under every covered index, so subsequent taps on related
   *  words return the same answer instantly without a fresh LLM call. */
  indices: number[];
}

export async function translateWordInContext(args: {
  sentence: string;
  word: string;
  wordIndex: number;
  nativeLanguage: string;
  targetLanguage: TargetLanguageSpec;
  /** Override the model tier. Defaults to "chat_light" (gpt-4o-mini),
   *  which after manual A/B testing on the playground handles the full
   *  task — segment selection, compound-tense detection, contextual
   *  translation — correctly. The earlier "te haya / du hat" miscut was
   *  a prompt-quality issue (since fixed by the by-grammatical-class
   *  restructure), not a model-capacity issue. Pass "chat_precise"
   *  (gpt-4o) only if the prompt drifts again on edge cases. */
  task?: ChatTask;
}): Promise<WordLookupResult> {
  const target = describeTargetLanguage(args.targetLanguage);
  const targetName = args.targetLanguage.language;
  const marked = markWordOccurrence(args.sentence, args.wordIndex);
  const words = tokenizeWords(args.sentence);
  const indexedWordList = words.map((w, i) => `  [${i}] ${w}`).join("\n");

  const prompt = `You are a translation assistant for a language learner studying ${target}. Their native language is ${args.nativeLanguage}.

The learner has tapped a single word in a ${targetName} sentence because they don't understand it. The tapped word is wrapped in «guillemets» so you know exactly which occurrence they mean (it may appear multiple times in the sentence).

TASK 1 — DECIDE THE SEGMENT (target-language side)
Decide whether the tapped word stands ALONE or belongs to a multi-word unit. Group it with related words when:
- The word is an article ("el", "la", "los", "las", "un", "una", "unos", "unas") and a noun follows → segment = article + noun ("el libro").
- The word is part of a COMPOUND TENSE: haber + past participle (he visto, había dicho, haya impresionado), estar + gerund (está hablando), ir a + infinitive (voy a hacer), modal periphrases (tener que ir, hay que hacerlo). Include any clitic object pronouns attached to the verbal complex (me, te, lo, la, le, nos, os, los, las, les, se). → segment = the whole construction.
- The word is part of an IDIOM or fixed expression (tener ganas, darse cuenta, echar de menos, por ejemplo, en cambio, sin embargo). → segment = the whole expression.
- The word is part of a MULTI-WORD NAMED ENTITY (Estados Unidos, Real Madrid, América Latina). → segment = the whole name.
Otherwise: segment = just the tapped word.

The segment MUST contain the tapped word, and every word in the segment MUST appear in the original sentence in its EXACT casing and form (do NOT lemmatise — "comió" stays "comió", "ha jugado" stays "ha jugado"). The segment's words may be NON-ADJACENT in the sentence — if intermediate words don't belong to the unit, skip them and join the kept words with single spaces. This "no lemmatising" rule applies ONLY to the target-language segment, NOT to the translation.

TASK 2 — TRANSLATE THE SEGMENT (native-language side)
The translation is shown OUT OF CONTEXT next to the segment, like a vocab card. It must read like a clean ${args.nativeLanguage} entry on its own.

Rule per grammatical type of the segment:

NOUN → include the ${args.nativeLanguage} definite article with correct gender.
  "diseño" → "das Design"  ·  "casa" → "das Haus"  ·  "Estados Unidos" → "die Vereinigten Staaten"

CONJUGATED VERB or COMPOUND TENSE (with or without clitics) → include the subject pronoun:
  · 1st / 2nd person: ALWAYS include (ich, du, wir, ihr, Sie).
    "opinas" → "du meinst"  ·  "opino" → "ich meine"  ·  "has visto" → "du hast gesehen"  ·  "voy a hacer" → "ich werde machen"  ·  "te haya impresionado" → "hat dich beeindruckt" (3rd person — see below; the clitic "te" is the OBJECT, not the subject)
  · 3rd person: prefer "(er/sie)" / "(sie)"; bare verb only when the subject is named explicitly in the sentence and is obvious.
    "opina" → "(er/sie) meint"  ·  "ha jugado" → "hat gespielt"  ·  "comió" → "(er/sie) aß"
  · Imperative (no subject in either language): bare form, no pronoun.
    "mira" → "schau"  ·  "ven" → "komm"

INFINITIVE (often inside an idiom or after a modal): keep as infinitive in ${args.nativeLanguage}.
  "tener ganas" → "Lust haben"  ·  "echar de menos" → "vermissen"  ·  "darse cuenta" → "merken"

ADJECTIVE / ADVERB: translate plain, no article needed.
  "rápido" → "schnell"  ·  "muy" → "sehr"  ·  "siempre" → "immer"

ARTICLE / PREPOSITION / FUNCTION WORD as solo segment: translate plain with the contextually correct sense.
  "para" (depending on context) → "für" or "um zu"  ·  "el" → "der" / "die" / "das" by referent's gender

In all cases:
- PRESERVE THE CONTEXTUAL MEANING when ambiguous (banco = bench vs bank; fuego = fire vs passion).
- USE NATURAL ${args.nativeLanguage} WORD ORDER (main-clause / V2). NEVER subordinate-clause final order. "hat dich beeindruckt" YES; "dich beeindruckt hat" NO.
- KEEP the tense / aspect / number / person of the segment so the meaning is equivalent.

TASK 3 — RETURN THE WORD INDICES OF THE SEGMENT
The sentence is also given as an indexed word list below. Return the indices of all words that constitute the segment (so the client can cache the result under every covered index — tapping any of them later shows the same answer without another call).

- The tapped word's index MUST be included in the indices array.
- Indices need NOT be contiguous — if the segment skips intermediate words, that's fine. Use exactly the words that belong to the segment.
- Use the indices as listed below. Do not invent new ones.

Sentence: "${args.sentence}"
Sentence with tapped word marked: "${marked}"
Tapped word: "${args.word}" (index ${args.wordIndex})

Words by index:
${indexedWordList}

Return ONLY valid JSON:
{
  "segment": "<the target-language segment, exact form from the sentence>",
  "translation": "<the standalone ${args.nativeLanguage} translation, vocab-card style, contextually correct meaning>",
  "indices": [<int>, <int>, ...]
}`;

  // Default tier is chat_light (gpt-4o-mini). After the prompt restructure
  // (worked examples grouped by grammatical class, separate Task 1/2/3
  // rules) mini handles compound tenses correctly — confirmed via A/B
  // playground testing against gpt-4o. ~17x cheaper for indistinguishable
  // output. Caller can pass task="chat_precise" to force gpt-4o.
  const task = args.task ?? "chat_light";
  const parsed = await chatJSON<{
    segment?: unknown;
    translation?: unknown;
    indices?: unknown;
  }>({
    task,
    label: `playground/translateWord/${task}`,
    systemPrompt: prompt,
    temperature: 0.2,
  });

  const segment =
    typeof parsed.segment === "string" && parsed.segment.trim()
      ? parsed.segment.trim()
      : args.word;
  const translation =
    typeof parsed.translation === "string" ? parsed.translation.trim() : "";

  // Validate indices: in-bounds, unique, must include the tapped word.
  // Falls back to [wordIndex] if the model returns garbage. We deliberately
  // do NOT check contiguity — segments may skip intermediate words.
  let indices: number[] = Array.isArray(parsed.indices)
    ? (parsed.indices as unknown[])
        .filter(
          (n): n is number =>
            typeof n === "number" && Number.isInteger(n) && n >= 0 && n < words.length,
        )
    : [];
  indices = Array.from(new Set(indices)).sort((a, b) => a - b);
  if (!indices.includes(args.wordIndex)) {
    indices = [args.wordIndex];
  }

  return { segment, translation, indices };
}
