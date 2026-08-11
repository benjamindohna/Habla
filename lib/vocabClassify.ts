// POS classifier for vocab segments. Takes a target-language word
// (possibly multi-word) plus the sentence it was tapped in, returns
// a coarse word-class label. Used by:
//   - vocabSave at insert time (the (target_word_lower, word_class) pair
//     becomes the dedup key — same word in different word classes is
//     stored as separate rows, e.g. "vino" the noun vs "vino" the verb)
//   - the explain prompt as the only anchor (replaces the old
//     english_description sense-key)
//
// Context is the ONLY use of the surrounding sentence: it disambiguates
// words whose word class is determined by syntactic position ("entreno"
// = verb in "Yo entreno…", noun in "El entreno…"). Once classification
// is done, downstream code never sees the sentence again — explain
// stays context-independent.
//
// The label set is deliberately small and coarse. We don't try to
// reproduce a full linguistic taxonomy — a learner just needs to know
// "is this a noun or a verb" most of the time.

import { chatJSON } from "./llm";
import type { TargetLanguageSpec } from "./targetLanguage";

export type WordClass =
  | "noun"
  | "verb"
  | "adjective"
  | "adverb"
  | "preposition"
  | "conjunction"
  | "pronoun"
  | "determiner"
  | "interjection"
  | "idiom"
  | "phrase";

const VALID: WordClass[] = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "preposition",
  "conjunction",
  "pronoun",
  "determiner",
  "interjection",
  "idiom",
  "phrase",
];

export interface ClassifyArgs {
  /** The captured segment as it appears on the card. Can be a single
   *  word ("piso", "comió") or a multi-word unit ("te haya llamado la
   *  atención", "Estados Unidos", "ha visto"). */
  target_word: string;
  /** The sentence the segment was tapped in. Used to disambiguate
   *  syntactic role for words like "entreno" that have both noun and
   *  verb readings. The classifier MUST commit to one class. */
  context_sentence: string;
  targetLanguage: TargetLanguageSpec;
}

/**
 * Returns one of the WordClass labels. Falls back to "noun" if the
 * LLM returns something we can't map — better than throwing during a
 * fire-and-forget save flow.
 */
export async function classifyVocab(args: ClassifyArgs): Promise<WordClass> {
  const prompt = `You are classifying a captured ${args.targetLanguage.language} vocabulary segment by its word class, based on how it functions in the sentence the learner tapped it from.

Return ONE of these labels:
  - noun          (la casa, el piso, Estados Unidos, el entreno)
  - verb          (como, comió, ha visto, te haya llamado, voy a hacer)
  - adjective     (rápido, interesante)
  - adverb        (siempre, muy, ayer)
  - preposition   (en, sobre, hacia)
  - conjunction   (pero, aunque, porque)
  - pronoun       (yo, te, esto)
  - determiner    (el, la, este, mi)
  - interjection  (¡vaya!, hola)
  - idiom         (a fixed expression with a verb at its head and a
                   noun argument that's essential to the meaning —
                   "darse cuenta", "echar de menos", "tener miedo",
                   "te haya llamado la atención", "por ejemplo",
                   "sin embargo", "a pesar de")
  - phrase        (a multi-word unit that doesn't fit anything above —
                   use sparingly)

Pick by SYNTACTIC FUNCTION in the sentence, not by surface form:
  - "entreno" in "Yo entreno todos los días"   → verb
  - "entreno" in "El entreno fue duro"         → noun
  - "como" in "Yo como pizza"                  → verb
  - "como" in "Es alto como su padre"          → conjunction (or preposition — pick whichever fits naturally)
  - "vino" in "Pedro vino tarde"               → verb
  - "vino" in "Tomamos vino"                   → noun

A compound tense or verbal periphrasis ("he visto", "voy a hacer", "te haya llamado") is a verb, even though it's multi-word. An idiomatic verb+noun combination ("te haya llamado la atención", "darse cuenta") is an idiom — the idiom label wins over verb when the captured segment is the full fixed expression.

Segment: "${args.target_word}"
Sentence: "${args.context_sentence}"

Return ONLY valid JSON:
{
  "word_class": "<one of the labels above>"
}`;

  const result = await chatJSON<{ word_class?: string }>({
    task: "chat_light",
    label: "vocab/classify",
    systemPrompt: prompt,
    temperature: 0,
  });
  const raw = (result.word_class ?? "").trim().toLowerCase();
  if ((VALID as string[]).includes(raw)) {
    return coerceMultiWord(args.target_word, raw as WordClass);
  }
  // Safe fallback — most ambiguous "what is this" is some kind of noun.
  return coerceMultiWord(args.target_word, "noun");
}

/** Classes that can only ever describe a SINGLE word. A multi-word
 *  segment labeled with one of these is a classifier miss ("una carta
 *  muy poderosa" came back as "adjective"), and that mislabel poisons
 *  downstream: the explain prompt, told to translate the segment "in
 *  its word class adjective", collapsed to translating just the one
 *  word that fit the class ("muy" → "sehr"). Deterministic backstop:
 *  coerce such combinations to "phrase". Multi-word nouns ("la
 *  mayoría", "Estados Unidos"), verbs (compound tenses "voy a hacer"),
 *  and idioms stay untouched. */
const SINGLE_WORD_ONLY: ReadonlySet<WordClass> = new Set([
  "adjective",
  "adverb",
  "preposition",
  "conjunction",
  "pronoun",
  "determiner",
  "interjection",
]);

function coerceMultiWord(targetWord: string, wordClass: WordClass): WordClass {
  const wordCount = targetWord.trim().split(/\s+/).length;
  if (wordCount > 1 && SINGLE_WORD_ONLY.has(wordClass)) {
    // Two-word units can legitimately be adverbial/prepositional
    // ("muy pintoresco", "sin embargo") — only coerce from 3 words up,
    // where a single-word class is definitely wrong.
    if (wordCount >= 3) return "phrase";
  }
  return wordClass;
}
