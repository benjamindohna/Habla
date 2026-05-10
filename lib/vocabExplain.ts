// Generates the native-language translation + hint for a vocab card.
// Used in three places, all on the same prompt:
//   - /api/vocab/explain (cache-aware: cache hit → return; miss → generate + write back)
//   - vocabSave async pre-generation (right after insert)
//   - scripts/backfillVocabAssets.ts (one-shot for legacy rows)

import { chatJSON } from "./llm";

export interface ExplainArgs {
  /** Target word as shown on the card (preserves casing / form). */
  target_word: string;
  /** The English sense-key for the row. */
  english_description: string;
  /** e.g. "Spanish". */
  target_language: string;
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
  const prompt = `You are a vocabulary tutor. The learner is studying ${args.target_language}; their native language is ${args.native_language}.

The learner couldn't recall this word. Give a clear, structurally-faithful answer plus a short memory aid.

The TRANSLATION must be the natural ${args.native_language} equivalent that mirrors the STRUCTURE of the target word — preserve every semantic component the target carries:
- Single noun → article (with correct gender) + noun.
- Single conjugated verb → infinitive form, OR include the subject pronoun if the conjugation is distinctive (1st/2nd person).
- Multi-word verbal phrase (compound tense, modal periphrasis, clitic + verb) → full ${args.native_language} equivalent that preserves tense, aspect, and any clitic objects. Do NOT collapse to a single word.
- Idiom / fixed expression → idiomatic ${args.native_language} equivalent (or close paraphrase if no exact idiom exists).
- Adjective / adverb / function word → plain natural form.

Worked examples (target Spanish, native German — illustrative, the same logic applies to any pair):
- "casa"                → translation: "das Haus", hint: "Ein Gebäude, in dem man wohnt."
- "comer"               → translation: "essen", hint: "Mahlzeiten zu sich nehmen."
- "comió"               → translation: "(er/sie) aß / hat gegessen", hint: "Vergangenheit von essen."
- "banco" (financial)   → translation: "die Bank (Geldinstitut)", hint: "Wo man Geld einzahlt oder abhebt."
- "banco" (bench)       → translation: "die Sitzbank", hint: "Eine lange Bank, auf der man im Park sitzt."
- "te haya impresionado" → translation: "(es) hat dich beeindruckt (Konjunktiv Perfekt)", hint: "Form nach „que" oder „ojalá", drückt Unsicherheit aus."
- "darse cuenta"        → translation: "merken / bemerken (reflexiv)", hint: "Etwas plötzlich verstehen oder feststellen."
- "echar de menos"      → translation: "vermissen", hint: "Jemanden oder etwas Abwesendes vermissen."
- "voy a hacer"         → translation: "ich werde machen / ich gehe machen (nahe Zukunft)", hint: "Ankündigung einer baldigen Handlung."

Word: "${args.target_word}"
Sense being tested (in English): "${args.english_description}"

If the Word and the Sense seem to disagree (e.g. the Sense omits a clitic that the Word clearly carries), trust the Word — describe what the Word actually says.

Return ONLY valid JSON:
{
  "translation": "<full ${args.native_language} translation that mirrors the target's structure>",
  "hint": "<short ${args.native_language} example or memory aid that disambiguates THIS sense from other senses of the word, max 15 words, ends with a period>"
}`;

  const result = await chatJSON<{ translation?: string; hint?: string }>({
    task: "chat_light",
    label: "vocab/explain",
    systemPrompt: prompt,
    temperature: 0.3,
  });
  const translation = (result.translation ?? "").trim();
  const hint = (result.hint ?? "").trim();
  if (!translation) {
    throw new Error("vocab/explain: empty translation");
  }
  return { translation, hint };
}
