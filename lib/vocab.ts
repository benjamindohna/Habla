// Vocab helpers — input normalisation + description generator + (legacy)
// canonicalisation pipeline.
//
// The current ROADMAP architecture ("Vocabulary save & test —
// English-description-anchored") uses:
//   - normalizeVocab — pure deterministic input cleanup (kept)
//   - generateVocabDescription — LLM call producing the sense-key
//     description used to dedup synonyms and separate polysemes (kept)
//
// The Phase A/B casing pipeline + CasingClassifier interface below is
// LEGACY (see DISREGARDED_IDEAS.md). Will be removed when the new
// save flow is wired; kept now so the existing tests stay green.

import { chatText } from "./llm";
import { markWordOccurrence } from "./aiBubblePipeline";

/**
 * Standard normalisation. Always applied as the very first pass. Steps:
 *  - Unicode NFC composition (so é is one code-point, never e + combining acute)
 *  - trim
 *  - strip leading/trailing punctuation (Unicode-aware via \p{P} —
 *    handles ¿, ¡, «, » correctly)
 *  - collapse internal whitespace to single spaces
 *
 * Casing is NOT applied here when caseSensitive=true. Diacritics are NEVER
 * stripped (sí stays sí — different word from si). Lemmatisation is NEVER
 * applied (comió stays comió).
 *
 * The very first pass MUST be called with caseSensitive=true so the original
 * casing survives into the casing filter. Subsequent passes (after Phase A
 * has decided) are called with caseSensitive=false to lowercase the
 * "incidental" sides.
 */
export function normalizeVocab(s: string, caseSensitive: boolean = false): string {
  const base = s
    .normalize("NFC")
    .trim()
    .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "")
    .replace(/\s+/g, " ");
  return caseSensitive ? base : base.toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────
// Description generator — produces the English "sense-key" for a vocab
// entry. Anchors the SPECIFIC sense the tapped word had in this context.
// Used by the save flow to:
//   - dedup synonyms (same sense → same description → single row)
//   - separate polysemes (different senses → different descriptions →
//     separate rows with independent SRS state)
//
// Cost: gpt-4o-mini, ~250 input + ~10 output tokens, ~$0.000054 per call.
// ─────────────────────────────────────────────────────────────────────────

export interface DescribeWordArgs {
  /** The tapped word, surface form as encountered (e.g. "Bancos", "comió"). */
  target_word: string;
  /** The sentence in which the word appeared. Currently passed in full;
   *  if AI replies grow long the caller can window this to ~16 words
   *  before/after the tapped word. */
  context_sentence: string;
  /** Optional 0-based word index of the originally-tapped word inside
   *  context_sentence (using the shared WORD_REGEX). When provided, the
   *  prompt wraps that occurrence with «…» so the LLM knows exactly
   *  which instance of the word the learner means — defends against the
   *  case where the same word appears twice in the sentence with
   *  different senses. Optional because /playground/save-test users
   *  type the segment and context manually with no index. */
  tapped_word_index?: number;
  /** e.g. "Spanish". */
  target_language: string;
  /** e.g. "German". Used as a frame-setting hint, not as a translation
   *  reference — the description is in English regardless. */
  native_language: string;
}

/**
 * Generate the English sense-key description for a vocab entry.
 *
 * Returns a 3-7 word English phrase. Throws if the model output is
 * empty or implausibly long (likely a hallucination).
 *
 * Prompt validated by manual testing against polysemous Spanish words
 * (banco, fuego, hoja); model behaviour is consistent on synonym
 * collapse and polysemy separation.
 */
export async function generateVocabDescription(args: DescribeWordArgs): Promise<string> {
  const context =
    typeof args.tapped_word_index === "number" && args.tapped_word_index >= 0
      ? markWordOccurrence(args.context_sentence, args.tapped_word_index)
      : args.context_sentence;

  const prompt = `You are generating a sense-key for a vocabulary entry. The learner is studying ${args.target_language}; their native language is ${args.native_language}. They have just tapped a word in a ${args.target_language} sentence.

Write a SHORT English description (3-7 words) of the SPECIFIC SENSE the tapped word has in this sentence. The description is used as a sense-key: it must be precise enough that two genuinely different meanings of the same word produce noticeably different descriptions, but generic enough that two synonymous translations of the same meaning produce IDENTICAL descriptions.

Rules:
- 3 to 7 words. No leading article. No trailing period.
- Describe the meaning, not the form (do not write tense / number).
- Be neutral about register / dialect.
- The context may wrap the tapped word in «guillemets» — that marks exactly which occurrence the learner tapped (the same word may appear multiple times in different senses). Use that marker to disambiguate.

Worked examples:
  "banco" in "el «banco» está cerrado los domingos"          → "financial institution"
  "banco" in "me senté en el «banco» del parque"             → "long bench to sit on"
  "fuego" in "encendió el «fuego» en la chimenea"            → "literal fire / flame"
  "fuego" in "siento un «fuego» dentro al verla"             → "passionate intensity / inner fire"
  "hoja" in "la «hoja» se cayó del árbol en otoño"           → "leaf of a plant"
  "hoja" in "necesito una «hoja» de papel"                   → "sheet of paper"
  "hoja" in "la «hoja» del cuchillo está afilada"            → "blade of a cutting tool"
  "comer" in "vamos a «comer» pasta"                         → "to eat (food, meal)"
  "Madrid" in "vivo en «Madrid» desde hace cinco años"       → "Madrid (city, capital of Spain)"
  "Coca-Cola" in "una «Coca-Cola» fría"                      → "Coca-Cola (the soft drink brand)"
  Multi-word segment example:
  "te haya impresionado" in "un partido que te «haya» impresionado" → "has impressed (subjunctive perfect)"
  (Here the tapped word is just "haya" but the segment to describe is the whole compound tense.)

Word: "${args.target_word}"
Context: "${context}"

Return ONLY the description string. No JSON, no quotes, no explanation.`;

  const raw = await chatText({
    task: "chat_light",
    label: "vocab/describe",
    systemPrompt: prompt,
    temperature: 0.2,
  });

  // The model occasionally wraps the output in quotes despite the
  // instruction. Strip them and any trailing period drift.
  const cleaned = raw.replace(/^["'\s]+|["'.\s]+$/g, "").trim();
  if (!cleaned) {
    throw new Error("vocab/describe: LLM returned empty description");
  }
  if (cleaned.length > 80) {
    throw new Error(`vocab/describe: overlong output (${cleaned.length} chars): "${cleaned}"`);
  }
  return cleaned;
}

// ─────────────────────────────────────────────────────────────────────────
// Vocab judge — evaluates the learner's answer in a vocab review.
// Replaces all the deterministic match logic (exact match / Levenshtein /
// synonym lists / lemmatize-and-compare) with a single LLM call that
// understands semantic equivalence, typos, missing articles, polysemy.
//
// Outputs one of three single-character verdicts:
//   "1" — answer matches the tested sense → SRS stage advance
//   "X" — answer matches a DIFFERENT known sense of the word → stage
//          unchanged, UI tells the learner to provide the other meaning
//   "0" — answer is wrong, empty, or just echoes the target word → lapse
//
// Cost: gpt-4o-mini, ~250 input + ~1-3 output tokens. With OpenAI's
// prompt caching of the static examples block, ~$0.000018 per call.
// At 40 reviews/day: ~$0.02/month. Negligible.
// ─────────────────────────────────────────────────────────────────────────

export type VocabJudgement = "1" | "X" | "0";

export interface JudgeArgs {
  /** The target-language word being tested (surface form, with original casing). */
  target_word: string;
  /** The English sense-key for the row being tested. */
  tested_description: string;
  /** The learner's typed/spoken answer in their native language. */
  user_answer: string;
  /** e.g. "Spanish". */
  target_language: string;
  /** e.g. "German". */
  native_language: string;
}

/**
 * Decide whether the learner's answer is an acceptable native-language
 * translation of the tested sense.
 *
 * Three-bucket output:
 *  - "1": answer matches the tested sense (or is ambiguous and could plausibly mean it)
 *  - "X": answer unambiguously refers to a DIFFERENT sense of the same word
 *  - "0": answer is wrong, empty, or just echoes the target word
 *
 * The LLM uses its own linguistic knowledge of the target language to
 * recognise alternative meanings — we no longer pass other senses from
 * the user's stored vocab. This means a user who knows "banco" can
 * also mean "Geldinstitut" (without having that as a stored row) gets
 * the X→retry treatment instead of an immediate 0.
 *
 * Conservative parsing: if the model output doesn't contain 1/X/0,
 * defaults to "0" (lapse). False rejects are reparable next review;
 * accepting garbage would corrupt SRS state.
 *
 * Three-strikes UX (handled in the frontend, server is stateless across
 * attempts): on first X, show "Diese Übersetzung ist korrekt, aber wir
 * suchen nach einer anderen." On second X, show "Kannst du nach noch
 * einer weiteren Übersetzung für ${word} denken?" On third X, mark the
 * card as failed with "Du hast leider nicht die Übersetzung getroffen,
 * nach der wir gesucht haben."
 */
export async function judgeVocabAnswer(args: JudgeArgs): Promise<VocabJudgement> {
  const prompt = `You are evaluating a vocabulary review answer for a language learner.
The learner is studying ${args.target_language}; their native language is ${args.native_language}.

You receive:
- A ${args.target_language} word being tested.
- The SENSE of this word being tested, described in English.
- The learner's answer in ${args.native_language}.

Decide whether the learner's answer is an acceptable ${args.native_language} translation of the TESTED sense.

Be LENIENT on:
- missing or extra articles ("Hund" ≈ "der Hund")
- synonymous wording ("Bank" ≈ "Geldinstitut")
- minor typos ("Sitzbqnk" → accept as "Sitzbank")
- capitalisation
- minor inflection differences (singular ≈ plural if the sense is the same)
- AMBIGUOUS answers that could plausibly mean the tested sense — accept (return 1), even if they could also mean something else.

Be STRICT on:
- actual meaning mismatch
- empty answers
- the learner just echoing the target word back instead of translating
- answers in the wrong language

Output exactly ONE character, no other text:
- 1  the answer matches the TESTED sense, OR is ambiguous and could plausibly refer to the tested sense
- X  the answer UNAMBIGUOUSLY refers to a DIFFERENT sense of "${args.target_word}" — use your own linguistic knowledge of ${args.target_language} to recognise alternative meanings; you are NOT given a list of other known senses. Reserve X for answers that can ONLY mean a different sense, never for answers that could plausibly mean the tested sense.
- 0  the answer is wrong, empty, or just echoes the target word

Examples (illustrative — Spanish target, German native; rules apply to any language pair):

Tested word: "banco" — sense: "long bench to sit on"
  "Sitzbank"           → 1
  "Bank"               → 1   (ambiguous — Bank can mean Sitzbank OR Geldinstitut, accept)
  "die Sitzbank"       → 1   (extra article, accept)
  "sitzbank"           → 1   (lowercase, accept)
  "Sitzbqnk"           → 1   (minor typo, accept)
  "Bank zum Sitzen"    → 1   (synonym phrasing, accept)
  "Geldinstitut"       → X   (unambiguously the financial-bank sense, valid alt meaning)
  "Finanzinstitut"     → X   (unambiguously the financial-bank sense)
  "Schrank"            → 0   (unrelated)
  ""                   → 0   (empty)
  "banco"              → 0   (just echoed the target word)

Tested word: "comer" — sense: "to eat (food, meal)"
  "essen"              → 1
  "fressen"            → 1   (register-different synonym, accept)
  "isst"               → 1   (different inflection, same meaning, accept)
  "trinken"            → 0   (different meaning)
  "comer"              → 0   (echoed target word)

Tested word: "fuego" — sense: "literal fire / flame"
  "Feuer"              → 1
  "Leidenschaft"       → X   (unambiguously the passion / inner-fire sense, valid alt meaning)
  "Schrank"            → 0   (unrelated)

Tested word: "haya impresionado" — sense: "has impressed (subjunctive perfect)"
  "hat beeindruckt"    → 1
  "beeindruckt hat"    → 1   (different word order, same meaning, accept)
  "beeindrucken"       → 0   (infinitive, doesn't carry the perfect aspect)

Now evaluate.

Tested word: "${args.target_word}"
Sense being tested: "${args.tested_description}"
Learner's answer: "${args.user_answer}"

Reply with exactly one character: 1, X, or 0. No explanation, no punctuation, no quotes.`;

  const raw = await chatText({
    task: "chat_light",
    label: "vocab/judge",
    systemPrompt: prompt,
    temperature: 0,
    maxTokens: 5,
  });

  // Conservative parse: extract the first 1, X, or 0 in the output.
  // If none found, default to "0" — better to under-credit a correct
  // answer (the user re-encounters the card) than to over-credit and
  // corrupt the SRS schedule.
  const match = raw.match(/[1X0]/i);
  return (match?.[0] || "0").toUpperCase() as VocabJudgement;
}

// ─────────────────────────────────────────────────────────────────────────
// Vocab comparator — at save time, when the target_word_lower of the new
// entry collides with one or more existing entries for this user, decide
// whether the new entry is a synonym of one of them (→ discard the new
// one) or a different sense (→ keep as a polyseme row).
//
// Cost: gpt-4o-mini, ~250 input + ~3 output tokens, ~$0.00005 per call.
// Fires only on collision (most saves never reach it).
// ─────────────────────────────────────────────────────────────────────────

export interface CompareDescriptionsArgs {
  /** The target-language word (or multi-word segment) being saved. */
  target_word: string;
  /** The English sense-key of the NEW entry being considered. */
  new_description: string;
  /** English sense-keys of EXISTING entries for the same target_word_lower. */
  existing_descriptions: string[];
}

/**
 * Decide whether the new entry's description is a synonym of any of the
 * existing descriptions.
 *
 * Returns:
 *  - 0, 1, 2, ... — the 0-based index of the synonymous existing entry
 *  - -1           — different sense than ALL existing entries (insert as new)
 *
 * Conservative parsing: if the model output doesn't contain a parseable
 * integer in valid range, defaults to -1 (insert). False-positive
 * duplicates are reparable via manual UI; silently dropping a genuine
 * new sense is not.
 */
export async function compareVocabDescriptions(
  args: CompareDescriptionsArgs,
): Promise<number> {
  if (args.existing_descriptions.length === 0) return -1;

  const existingList = `[${args.existing_descriptions
    .map((s) => `"${s}"`)
    .join(", ")}]`;

  const prompt = `You are deciding whether a new vocabulary entry is a synonym of any existing entry the learner has stored for the same target word.

Inputs:
- The target-language word (or phrase) being saved.
- The English sense-key for the NEW entry.
- A list of English sense-keys for EXISTING entries the learner already has stored under the same target word.

For each existing entry, decide: does the NEW description and the EXISTING description describe the SAME meaning (synonyms, paraphrases, different ways of saying the same sense), or do they describe GENUINELY DIFFERENT senses of the same target word?

Output a single integer:
- 0, 1, 2, ...  the 0-based index of the existing entry the new entry is a synonym of
- -1            the new entry describes a different sense than ALL existing entries

If the new entry could plausibly be a synonym of more than one existing entry (which usually means the existing list itself has duplicates), pick the FIRST matching index.

Examples:

Word: "banco"
New: "long bench to sit on"
Existing: ["financial institution"]
→ -1   (different senses)

Word: "banco"
New: "park bench / outdoor seat"
Existing: ["long bench to sit on"]
→ 0    (synonym — same sense, different phrasing)

Word: "lluvia"
New: "rainfall / precipitation"
Existing: ["rainfall as weather"]
→ 0    (synonym)

Word: "hoja"
New: "blade of a knife"
Existing: ["leaf of a tree", "sheet of paper"]
→ -1   (different from both)

Word: "hoja"
New: "leaf falling from a tree"
Existing: ["leaf of a tree", "sheet of paper"]
→ 0    (synonym of index 0)

Word: "hoja"
New: "page in a notebook"
Existing: ["leaf of a tree", "sheet of paper"]
→ 1    (synonym of index 1)

Now decide.

Word: "${args.target_word}"
New: "${args.new_description}"
Existing: ${existingList}

Reply with a single integer (-1, 0, 1, 2, ...). No other text.`;

  const raw = await chatText({
    task: "chat_light",
    label: "vocab/compare",
    systemPrompt: prompt,
    temperature: 0,
    maxTokens: 5,
  });

  const match = raw.match(/-?\d+/);
  if (!match) return -1; // unparseable → conservative default: insert as new
  const verdict = parseInt(match[0], 10);
  // Validate range. -1 means new; 0..N-1 indexes into existing.
  if (verdict === -1) return -1;
  if (verdict >= 0 && verdict < args.existing_descriptions.length) return verdict;
  return -1; // out-of-range → conservative default
}

// ─────────────────────────────────────────────────────────────────────────
// LEGACY — Phase A/B casing pipeline. See DISREGARDED_IDEAS.md.
// Will be removed when the new save flow is wired; kept now so the
// existing tests stay green.
// ─────────────────────────────────────────────────────────────────────────

export type CasingDecision = "always" | "incidental";

/**
 * The LLM-backed pieces of the canonicalisation pipeline, abstracted so
 * tests can inject deterministic answers and the production code can wire
 * up real chatJSON calls.
 */
export interface CasingClassifier {
  /**
   * For a single word that starts uppercase, decide whether it's "always"
   * uppercase in its language (proper noun, German noun, brand) or
   * "incidental" (sentence-start position).
   *
   * counterpartTranslation MUST be passed — without it "Pan" could be
   * either bread (incidental) or a surname (always).
   */
  classifyCasing(args: {
    word: string;
    counterpartTranslation: string;
    side: "target" | "native";
  }): Promise<CasingDecision>;

  /**
   * Both sides came back "always" in Phase A. Is this a proper noun
   * (person/place/brand)?
   */
  isProperNoun(args: { target: string; native: string }): Promise<boolean>;
}

export type CanonicalizeResult =
  | { kind: "save"; target: string; native: string }
  | { kind: "skip"; reason: "same-form-proper-noun" };

function startsUpper(s: string): boolean {
  if (!s) return false;
  const first = s[0];
  return first !== first.toLowerCase() && first === first.toUpperCase();
}

/**
 * Full canonicalisation pipeline. Returns either a save instruction (with
 * the resolved casings) or a skip instruction (when both sides are an
 * identically-spelt proper noun like Madrid/Madrid).
 *
 * Flow per ROADMAP §1:
 *   Phase 0 (normalisation, casing preserved)
 *   → fast path if both sides start lowercase
 *   → Phase A: per-side LLM classify "always vs incidental uppercase"
 *   → Phase B (only if BOTH "always"): LLM classify "is proper noun"
 *     → if proper and forms identical: skip
 *     → if proper and forms differ: save with original case
 *     → if not proper: save with Phase A casings
 */
export async function canonicalizeVocab(
  rawTarget: string,
  rawNative: string,
  classifier: CasingClassifier,
): Promise<CanonicalizeResult> {
  const target = normalizeVocab(rawTarget, true);
  const native = normalizeVocab(rawNative, true);

  const targetUpper = startsUpper(target);
  const nativeUpper = startsUpper(native);

  // Phase 0 fast path: both already lowercase → save lowercased.
  if (!targetUpper && !nativeUpper) {
    return {
      kind: "save",
      target: target.toLowerCase(),
      native: native.toLowerCase(),
    };
  }

  // Phase A: classify each uppercase side. Sides that aren't uppercase
  // don't need a call — they're trivially "incidental" (i.e. lowercase).
  const targetCasing: CasingDecision = targetUpper
    ? await classifier.classifyCasing({
        word: target,
        counterpartTranslation: native,
        side: "target",
      })
    : "incidental";
  const nativeCasing: CasingDecision = nativeUpper
    ? await classifier.classifyCasing({
        word: native,
        counterpartTranslation: target,
        side: "native",
      })
    : "incidental";

  const bothAlways = targetCasing === "always" && nativeCasing === "always";

  if (!bothAlways) {
    return {
      kind: "save",
      target: targetCasing === "always" ? target : target.toLowerCase(),
      native: nativeCasing === "always" ? native : native.toLowerCase(),
    };
  }

  // Phase B: both "always". Proper noun?
  const isProper = await classifier.isProperNoun({ target, native });
  if (!isProper) {
    return { kind: "save", target, native };
  }

  // Proper noun: skip if forms are identical across languages, otherwise save.
  if (target.toLowerCase() === native.toLowerCase()) {
    return { kind: "skip", reason: "same-form-proper-noun" };
  }
  return { kind: "save", target, native };
}

// ─────────────────────────────────────────────────────────────────────────
// SRS scheduling constants. Anki SM-2's typical "good"-trajectory mapped
// onto a discrete 10-stage ladder. Stage 0 means "fresh / just failed —
// re-show in 1 minute". Stage 9 means "essentially permanent — re-show
// in ~4 years". On a "1" verdict the card advances by one stage; on "0"
// the stage halves (Math.floor(stage / 2)); on "X" nothing happens
// (the card stays in the queue at the same stage and last_seen).
// ─────────────────────────────────────────────────────────────────────────

export const STAGE_INTERVALS_SECONDS = [
  60,           // stage 0:  1 min
  86_400,       // stage 1:  1 day
  216_000,      // stage 2:  2.5 days
  518_400,      // stage 3:  6 days
  1_296_000,    // stage 4:  15 days
  3_283_200,    // stage 5:  38 days
  8_208_000,    // stage 6:  95 days
  20_736_000,   // stage 7:  240 days  (~8 months)
  51_840_000,   // stage 8:  600 days  (~1.6 years)
  129_600_000,  // stage 9:  1500 days (~4 years)
];

export const MAX_STAGE = STAGE_INTERVALS_SECONDS.length - 1;
