// Generates the native-language translation + hint for a vocab card.
// Used in three places, all on the same prompt:
//   - /api/vocab/explain (cache-aware: cache hit → return; miss → generate + write back)
//   - vocabSave async pre-generation (right after insert)
//   - scripts/backfillVocabAssets.ts (one-shot for legacy rows)

import { chatJSON } from "./llm";
import type { TargetLanguageSpec } from "./targetLanguage";

export interface ExplainArgs {
  /** Target word as shown on the card (preserves casing / form). */
  target_word: string;
  /** The sentence the word was tapped in. Sense-disambiguates polysemous
   *  words and provides a writing example for the hint. */
  context_sentence: string;
  /** English sense-key the row was saved under (e.g. "contrastive
   *  conjunction" for "que" in "mientras que"). The judge uses this as
   *  its ground truth, so the explanation has to translate THIS sense
   *  to stay consistent — otherwise the reveal panel shows an answer
   *  the judge would reject. Earlier versions deliberately decoupled
   *  this; that bought hedge-bet correctness against mis-aimed
   *  descriptions but at the cost of judge/explain divergence, which
   *  is more confusing for the learner than a consistently wrong row. */
  english_description: string;
  /** The learner's target-language spec — threaded from the session user. */
  targetLanguage: TargetLanguageSpec;
  /** e.g. "German". */
  native_language: string;
}

export interface Explanation {
  /** Vocab-card-style native-language translation that mirrors the
   *  target word's structure (article + noun, full multi-word phrase
   *  for compound tenses, etc.). */
  translation: string;
  /** Short native-language example or memory aid disambiguating
   *  THIS sense from other senses. ≤15 words. */
  hint: string;
}

/**
 * Pure async function — no auth, no DB. Throws on empty translation
 * (LLM hallucination guard). Hint may be empty (still usable).
 */
export async function generateExplanation(args: ExplainArgs): Promise<Explanation> {
  const prompt = `You are a vocabulary tutor. The learner is studying ${args.targetLanguage.language}; their native language is ${args.native_language}.

The learner couldn't recall this word. Give a clear, structurally-faithful answer plus a short memory aid.

CRITICAL — anchor on the TESTED SENSE. Below you will receive an English sense-key. Your translation must render THAT specific sense in ${args.native_language}, even when the word has other common meanings the learner might expect. Example: if the word is "que" and the tested sense is "contrastive conjunction (whereas / while)", translate as "wohingegen / während" — never "was / dass". The judge that evaluates the learner uses this same sense-key as ground truth, so a translation that drifts to a different sense will tell the learner an answer the judge will reject.

The TRANSLATION must be the natural ${args.native_language} equivalent that mirrors the STRUCTURE of the target word — preserve every semantic component the target carries:
- Single noun → article (with correct gender) + noun.
- Single conjugated verb → infinitive form, OR include the subject pronoun if the conjugation is distinctive (1st/2nd person).
- Multi-word verbal phrase (compound tense, modal periphrasis, clitic + verb) → full ${args.native_language} equivalent that preserves tense, aspect, and any clitic objects. Do NOT collapse to a single word.
- Idiom / fixed expression → idiomatic ${args.native_language} equivalent (or close paraphrase if no exact idiom exists).
- Adjective / adverb / function word → plain natural form.

CONTEXT-LEAK GUARD — translate the WORD'S CORE MEANING, not the context's flavour. The sentence is given for sense disambiguation and for the hint's example, never to colour the translation with topical context. Do not let topical nouns from the sentence ("birds", "ocean", "game", "teammates") leak into your translation. Litmus test: imagine the same word used in a different context tomorrow — would your translation still apply? If no, you've over-specified.

Worked examples (target Spanish, native German — illustrative, the same logic applies to any pair):
- "casa"                → translation: "das Haus", hint: "Ein Gebäude, in dem man wohnt."
- "comer"               → translation: "essen", hint: "Mahlzeiten zu sich nehmen."
- "comió"               → translation: "(er/sie) aß / hat gegessen", hint: "Vergangenheit von essen."
- "banco" in "Voy al banco a sacar dinero." → translation: "die Bank (Geldinstitut)", hint: "Wo man Geld einzahlt oder abhebt."
- "banco" in "Me senté en el banco del parque." → translation: "die Sitzbank", hint: "Eine lange Bank, auf der man im Park sitzt."
- "te haya impresionado" → translation: "(es) hat dich beeindruckt (Konjunktiv Perfekt)", hint: "Form nach „que" oder „ojalá", drückt Unsicherheit aus."
- "darse cuenta"        → translation: "merken / bemerken (reflexiv)", hint: "Etwas plötzlich verstehen oder feststellen."
- "echar de menos"      → translation: "vermissen", hint: "Jemanden oder etwas Abwesendes vermissen."
- "voy a hacer"         → translation: "ich werde machen / ich gehe machen (nahe Zukunft)", hint: "Ankündigung einer baldigen Handlung."

Anti-examples — these are CONTEXT-LEAK failures. The bad version pulls vocabulary from the surrounding clause into the translation; the good version stays at the word's lexical level:
- "canto" in "el canto de los pájaros"     → ❌ "der Gesang der Vögel"      ✅ "der Gesang"
- "olas" in "las olas chocaban con la playa" → ❌ "die Meereswellen"          ✅ "die Wellen"
- "buceo" in "fuimos a hacer buceo en Tailandia" → ❌ "das Sporttauchen"     ✅ "das Tauchen"
- "encontrar" in "no podía encontrar a sus compañeros" → ❌ "Mitspieler finden" ✅ "finden"
- "estilo" in "su estilo de juego es ofensivo" → ❌ "Spielstil" ✅ "der Stil"
- "toque" in "un toque sutil del defensa" → ❌ "geschickter Spielzug" ✅ "die Berührung"

Word: "${args.target_word}"
Tested sense (English sense-key — your translation must render THIS sense): "${args.english_description}"
Context where the word appears (use for the hint example; for sense, prefer the sense-key above): "${args.context_sentence}"

Return ONLY valid JSON:
{
  "translation": "<full ${args.native_language} translation that mirrors the target's structure>",
  "hint": "<short ${args.native_language} example or memory aid that disambiguates THIS sense from other senses of the word, max 15 words, ends with a period>"
}`;

  const result = await chatJSON<{ translation?: string; hint?: string }>({
    task: "chat_precise",
    label: "vocab/explain",
    systemPrompt: prompt,
    temperature: 0,
  });
  const translation = (result.translation ?? "").trim();
  const hint = (result.hint ?? "").trim();
  if (!translation) {
    throw new Error("vocab/explain: empty translation");
  }
  return { translation, hint };
}
