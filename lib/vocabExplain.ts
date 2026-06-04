// Generates the native-language translation + hint for a vocab card.
// Used in three places, all on the same prompt:
//   - /api/vocab/explain (cache-aware: cache hit → return; miss → generate + write back)
//   - vocabSave async pre-generation (right after insert)
//   - scripts/backfillVocabAssets.ts (one-shot for legacy rows)
//
// Philosophy: a vocab card teaches the word's MEANING SPACE within
// the lexical entry the learner originally encountered. Concretely:
//   - english_description acts as a SOFT anchor — it tells the LLM
//     which lexical entry / part-of-speech the row is about (was it
//     "vino" the noun = wine, or "vino" the verb = came?). The primary
//     translation leads with that sense.
//   - Polysemy WITHIN the same word class (same lexical entry, related
//     senses) is still surfaced as secondary translations and synonyms:
//     "banco" → bank + bench; "vela" → candle + sail.
//   - Cross-POS HOMOGRAPHS (different word, same spelling — "vino"
//     verb vs noun; "como" verb vs comparator; "para" verb vs
//     preposition) are NOT mixed onto the same card. They live as
//     separate rows already (different english_description → different
//     vocab entry), so each card stays focused on one lexical entry.
//
// The sentence-mode judge is loosened in lockstep — it accepts any
// well-known sense, so polysemy mismatches in production are fine.
// The judge still uses english_description as the row identity but
// no longer rejects sentences that anchor a different sense.

import { chatJSON } from "./llm";
import type { TargetLanguageSpec } from "./targetLanguage";

export interface ExplainArgs {
  /** Target word as shown on the card (preserves casing / form). */
  target_word: string;
  /** English sense-key the row was saved under. Used as a soft anchor:
   *  it tells the prompt which lexical entry / part-of-speech the row
   *  represents, so the translation leads with that sense and skips
   *  cross-POS homographs of the same spelling. */
  english_description: string;
  /** The sentence the word was tapped in. Soft cue for the hint's
   *  usage example. The translation itself is meant to cover the
   *  word's meaning space within the anchored lexical entry. */
  context_sentence: string;
  /** The learner's target-language spec — threaded from the session user. */
  targetLanguage: TargetLanguageSpec;
  /** e.g. "German". */
  native_language: string;
}

export interface Explanation {
  /** Compact native-language string covering the primary translation,
   *  common synonyms, and other related senses within the same lexical
   *  entry. Cross-POS homographs are deliberately excluded. */
  translation: string;
  /** Short native-language usage example or memory aid. ≤15 words. */
  hint: string;
}

/**
 * Pure async function — no auth, no DB. Throws on empty translation
 * (LLM hallucination guard). Hint may be empty (still usable).
 */
export async function generateExplanation(args: ExplainArgs): Promise<Explanation> {
  const prompt = `You are a vocabulary tutor. The learner is studying ${args.targetLanguage.language}; their native language is ${args.native_language}.

Produce a vocabulary card answer for the target word. The answer is shown when the learner reveals the card — your job is to teach the word's MEANING SPACE within the specific lexical entry the learner encountered.

═════ ANCHORING ═════

Below you receive an English sense-key. This identifies WHICH LEXICAL ENTRY the row is about — crucial when the spelling is shared across different words (e.g. Spanish "vino" can be the noun "wine" OR the verb "came" — totally unrelated words that happen to be spelled the same). Lead with the sense the key indicates; if the same spelling exists as a different part of speech / different etymological word, DO NOT mention that other word on this card. It lives on its own row.

Inside the anchored lexical entry, however, fully cover polysemy: related senses of the SAME word in the SAME word class should all appear (e.g. "banco" the noun → bank AND bench; "vela" the noun → candle AND sail; "correr" the verb → run physically AND run/operate something).

═════ TRANSLATION FORMAT ═════

THE TRANSLATION must cover, within the anchored lexical entry only:
- The PRIMARY ${args.native_language} translation matching the sense-key, in the natural form that mirrors the target's structure (article + noun for nouns, infinitive for verbs, full phrase for multi-word verb forms, idiomatic equivalent for fixed expressions).
- Common SYNONYMS in ${args.native_language} (1–3, only when they meaningfully exist — don't pad).
- Other distinct SENSES of the same lexical entry if it's polysemous within its word class. Tag each with a 1–3 word disambiguator in parentheses.

CRITICAL — synonyms ≠ senses. A "sense" is a DIFFERENT MEANING the word can carry in a different real-world context. A "synonym" is an alternative ${args.native_language} word for the SAME meaning. Test before using "auch:":
- Can the two translations be used interchangeably in the same sentence with the same effect? → they are synonyms, not senses. Put them under "Synonyme:" or pick the better one. NEVER use "auch:".
- Can each translation only apply in a different real-world context (bank-money vs bank-bench; candle vs sail; fire-flame vs fire-passion)? → they are senses. Use "auch:".
If you have nothing that meets the "auch:" bar, omit "auch:" entirely. A card with one clean primary translation is better than a card with a fake second sense.

Format the translation as a compact readable string. Pattern:
  <primary translation>; Synonyme: <syn1>, <syn2>; auch: <sense> (<tag>); auch: <sense> (<tag>)
Use as many \`auch:\` entries as the word actually has distinct senses — DO NOT stop at one. A truly polysemous noun like Spanish "piso" has three (apartment / floor-storey / floor-surface); "banco" has two (financial / bench); "vela" has two (candle / sail). Don't pad either — only add \`auch:\` entries that meet the synonym-vs-sense test above. Drop any section that doesn't apply. Keep it tight — this is shown on a flashcard, not a dictionary entry. Use ${args.native_language} for the section labels (the example uses German; adapt to the learner's native language).

THE HINT is one short ${args.native_language} sentence (≤15 words) giving a typical usage example or memory aid. Use the anchored sense. Ends with a period.

═════ WORKED EXAMPLES (Spanish target, German native — illustrative; same logic applies to any language pair) ═════

Polysemy within the same word class — surface ALL the distinct senses, not just one:
- "banco" (sense: "financial institution / bank")
    → translation: "die Bank (Geldinstitut); auch: die Sitzbank (Möbel)"
       hint: "Zur Bank gehen, um Geld abzuheben."
- "vela" (sense: "candle for lighting")
    → translation: "die Kerze; auch: das Segel (am Boot)"
       hint: "Eine Kerze anzünden."
- "piso" (sense: "apartment / flat") — THREE senses, list all:
    → translation: "die Wohnung; Synonyme: das Apartment; auch: das Stockwerk (Gebäude); auch: der Boden (Fußboden)"
       hint: "Eine Wohnung in der Stadt kaufen."

Cross-POS homographs — do NOT mention the other word:
- "vino" (sense: "wine / alcoholic drink from grapes")
    → translation: "der Wein"
       hint: "Ein Glas Rotwein zum Essen."
   (The verb "vino" = "came" is a different lexical entry — not mentioned here.)
- "vino" (sense: "3rd-person past of venir / came")
    → translation: "(er/sie) kam (Vergangenheit von venir)"
       hint: "Vergangenheitsform von venir: Wer kam wann?"
   (The noun "vino" = "wine" is a different lexical entry — not mentioned here.)
- "como" (sense: "1st-person present of comer / I eat")
    → translation: "(ich) esse (1. Person Präsens von comer)"
       hint: "Heute esse ich Pasta."
- "como" (sense: "as / like — comparison conjunction")
    → translation: "wie, als (Vergleich); Synonyme: gleich wie"
       hint: "Sie ist groß wie ihr Vater."
- "para" (sense: "for / in order to — preposition")
    → translation: "für, um zu (Zweck)"
       hint: "Ein Geschenk für meine Mutter."

Anti-example — DO NOT make this mistake:
- "te haya llamado la atención" (sense: "has caught your attention")
    ❌ "aufgefallen ist; auch: bemerkt hat"
       (these are synonyms, not different senses — "auch:" is wrong here)
    ✅ "(es) hat dir aufgefallen / hat deine Aufmerksamkeit erregt (Konjunktiv Perfekt von 'llamar la atención')"
       (one primary translation with a synonym variant; no fake second sense)

Standard cases — no homograph conflict:
- "casa" (sense: "house / dwelling")
    → translation: "das Haus; Synonyme: das Heim, das Zuhause"
       hint: "Ein Gebäude, in dem man wohnt."
- "comer" (sense: "to eat / consume food")
    → translation: "essen; Synonyme: speisen"
       hint: "Mahlzeiten zu sich nehmen."
- "comió" (sense: "ate, 3rd person past")
    → translation: "(er/sie) aß / hat gegessen (Vergangenheit von essen)"
       hint: "Vergangenheitsform: Was hat er/sie gegessen?"
- "echar de menos" (sense: "to miss someone")
    → translation: "vermissen; Synonyme: sich nach jdm. sehnen"
       hint: "Jemanden vermissen, der weit weg ist."
- "darse cuenta" (sense: "to realize / notice")
    → translation: "merken, bemerken; Synonyme: realisieren, feststellen"
       hint: "Etwas plötzlich verstehen."

═════ NOW EVALUATE ═════

Word: "${args.target_word}"
Sense-key (anchors which lexical entry — translate this entry's meaning space, do not mention cross-POS homographs of the same spelling): "${args.english_description}"
Context where the word was first seen (soft cue for the hint; don't let it narrow the translation beyond the lexical entry): "${args.context_sentence}"

Return ONLY valid JSON:
{
  "translation": "<compact ${args.native_language} translation covering the anchored lexical entry's primary meaning + synonyms + related senses>",
  "hint": "<one short ${args.native_language} usage example or memory aid for the anchored sense, max 15 words, ends with a period>"
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
