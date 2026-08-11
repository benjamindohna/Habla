// Generates the native-language translation for a vocab card.
// Used in three places, all on the same prompt:
//   - /api/vocab/explain (cache-aware: cache hit → return; miss → generate + write back)
//   - vocabSave async pre-generation (right after insert)
//   - scripts/backfillVocabAssets.ts and scripts/reExplainAll.ts
//
// Philosophy (post-refactor): a vocab card lists ALL common meanings
// of the captured form within its anchored word class, like a clean
// dictionary entry. The anchor is the word_class (noun / verb /
// idiom / etc.) — NOT a per-sense english description (which was
// dropped because it created more disambiguation problems than it
// solved; see git history if curious).
//
// Form fidelity is critical: the translation matches the exact form
// the learner encountered. "como" the verb → "(ich) esse", not "essen".
// "comió" → "(er/sie) aß", not "essen". "pisos" → "die Wohnungen",
// not "die Wohnung". The morphological info is part of what the
// learner is encoding.
//
// Context is intentionally NOT used here — classification already
// happened (vocabClassify), and the further explanation per row stays
// context-independent so the same word produces the same card
// regardless of where it was originally tapped. Cross-encounter
// repetition is the whole point of SRS.
//
// Hint field is gone. A future "Explain further" button (see
// FEATURE_IDEAS §10) will produce richer on-demand explanations with
// examples + usage notes.

import { chatJSON } from "./llm";
import type { TargetLanguageSpec } from "./targetLanguage";
import type { WordClass } from "./vocabClassify";

export interface ExplainArgs {
  /** Target word as shown on the card (preserves casing / form). */
  target_word: string;
  /** The word's syntactic class — anchors which meanings to list. */
  word_class: WordClass;
  /** The learner's target-language spec — threaded from the session user. */
  targetLanguage: TargetLanguageSpec;
  /** e.g. "German". */
  native_language: string;
}

export interface Explanation {
  /** Compact native-language string listing all common meanings of the
   *  word for its word class. Distinct senses separated by semicolons. */
  translation: string;
}

/** Exported for prompt regression tests (scripts hit it with bench
 *  models when the prod key isn't available locally). */
export function buildExplainPrompt(args: ExplainArgs): string {
  return `You are a vocabulary tutor. The learner is studying ${args.targetLanguage.language}; their native language is ${args.native_language}.

The learner captured a ${args.targetLanguage.language} word. Produce a clean ${args.native_language} translation that lists all the common meanings of this word, in its given word class.

═════ FORM FIDELITY ═════

Translate the FORM exactly as captured, NOT the dictionary lemma. The morphological information is part of what the learner is encoding:
- A 1st-person verb form gets a 1st-person ${args.native_language} translation:
    "como" (verb) → "(ich) esse"          NOT "essen"
    "entreno" (verb) → "(ich) trainiere"  NOT "trainieren"
- A 3rd-person past form gets a 3rd-person past:
    "comió" (verb) → "(er/sie) aß"  or  "(er/sie) hat gegessen"   NOT "essen"
- A plural noun stays plural; a SINGULAR noun stays singular even when it has multiple senses listed:
    "casas" (noun, plural) → "die Häuser"   NOT "das Haus"
    "piso" (noun, SINGULAR) → "die Wohnung; das Stockwerk; der Boden"   NOT "die Wohnungen; die Stockwerke; die Böden"
  Multiple semicolon-separated senses are MEANINGS, not COUNT. The form of each translated noun mirrors the form of the source noun.
- A compound tense keeps tense and aspect:
    "ha visto" (verb) → "(er/sie) hat gesehen"   NOT "sehen"
    "voy a hacer" (verb) → "(ich) werde machen"  NOT "machen"
- An idiom in a tensed form keeps that tense:
    "te haya llamado la atención" (idiom) → "(es) ist dir aufgefallen / hat deine Aufmerksamkeit erregt (Konjunktiv Perfekt)"
- Singular nouns get the natural ${args.native_language} article + gender:
    "piso" (noun) → "die Wohnung"
    "vela" (noun) → "die Kerze"

Subject-pronoun handling for verbs (when ${args.native_language} is German):
- 1st / 2nd person: include the pronoun explicitly (ich, du, wir, ihr) without parentheses.
- 3rd person: prefer "(er/sie)" / "(sie)" in parentheses to mark that the subject is unspecified.
- Imperative: bare form.

═════ MEANING COVERAGE ═════

List ALL the common meanings the word carries IN ITS WORD CLASS. Use simple semicolons between distinct meanings — no special markers, no "auch:", no "Synonyme:". Just a flat list. The learner reads them all.

Tag each meaning with a 1-3 word disambiguator in parentheses ONLY when the meanings could otherwise be confused (e.g. "die Bank" alone is ambiguous in German).

═════ MULTI-WORD SEGMENTS ═════

If the captured word is a MULTI-WORD segment, translate the ENTIRE
segment as one unit. The translation must cover every content word —
NEVER translate just one word from inside it, even if the given word
class seems to fit only that one word. If the word class and the
segment disagree (e.g. a noun phrase labeled "adjective"), trust the
SEGMENT and translate all of it; the class is only a hint.
- "una carta muy poderosa" (phrase) → "eine sehr mächtige Karte"   NOT "sehr", NOT "mächtig"
- "el hecho de que" (phrase) → "die Tatsache, dass"
- "la fuerza correcta" (noun) → "die richtige Kraft"   NOT "die Kraft"

Examples:
- "piso" (noun) → "die Wohnung; das Stockwerk; der Boden"
- "vela" (noun) → "die Kerze; das Segel"
- "banco" (noun) → "die Bank (Geldinstitut); die Sitzbank (Möbel)"
- "como" (verb) → "(ich) esse"  (no other common verb meaning for the 1st-person form)
- "comió" (verb) → "(er/sie) aß; (er/sie) hat gegessen"
- "casa" (noun) → "das Haus"
- "echar de menos" (idiom) → "vermissen"
- "darse cuenta" (idiom) → "(etwas) merken; bemerken; realisieren"
- "te haya llamado la atención" (idiom) → "(es) ist dir aufgefallen; hat deine Aufmerksamkeit erregt (Konjunktiv Perfekt)"
- "rápido" (adjective) → "schnell"
- "muy" (adverb) → "sehr"
- "pero" (conjunction) → "aber"

CROSS-POS HOMOGRAPHS: do NOT mention meanings from a different word class. "vino" the noun (= Wein) and "vino" the verb (= came) live on separate cards; mention only the one matching the word_class given. A noun-classified "vino" card lists wine senses ONLY — no verb meanings.

═════ NOW EVALUATE ═════

Word: "${args.target_word}"
Word class: ${args.word_class}
Native language: ${args.native_language}

Return ONLY valid JSON:
{
  "translation": "<semicolon-separated meanings, form-faithful, matching the captured form's grammar>"
}`;
}

/**
 * Pure async function — no auth, no DB. Throws on empty translation
 * (LLM hallucination guard).
 */
export async function generateExplanation(args: ExplainArgs): Promise<Explanation> {
  const prompt = buildExplainPrompt(args);
  const result = await chatJSON<{ translation?: string }>({
    task: "chat_precise",
    label: "vocab/explain",
    systemPrompt: prompt,
    temperature: 0,
  });
  const translation = (result.translation ?? "").trim();
  if (!translation) {
    throw new Error("vocab/explain: empty translation");
  }
  return { translation };
}
