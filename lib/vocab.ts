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
import type { TargetLanguageSpec } from "./targetLanguage";

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
  targetLanguage: TargetLanguageSpec;
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

  const prompt = `You are generating a sense-key for a vocabulary entry. The learner is studying ${args.targetLanguage.language}; their native language is ${args.native_language}. They have just tapped a word in a ${args.targetLanguage.language} sentence.

Write a SHORT English description (3-7 words) of the SPECIFIC SENSE the tapped word has in this sentence. The description is used as a sense-key: it must be precise enough that two genuinely different meanings of the same word produce noticeably different descriptions, but generic enough that two synonymous translations of the same meaning produce IDENTICAL descriptions.

Rules:
- 3 to 9 words. No leading article. No trailing period.
- Describe the meaning, not the morphological form (no bare "tense / number" labels for single-word lexemes).
- Be neutral about register / dialect.
- The context may wrap the tapped word in «guillemets» — that marks exactly which occurrence the learner tapped (the same word may appear multiple times in different senses). Use that marker to disambiguate.
- CRITICAL — capture the WORD'S CORE ESSENCE, not the context's flavour. The description is a sense-key that must work for ANY future use of this word. Strip every topical qualifier the context introduced ("of birds", "in the sea", "as a sport", "for food", "by nature", "in a game", "for teammates", "of the ocean") unless the qualifier is part of the WORD'S actual lexical meaning. Litmus test: imagine the same word used in a completely different context tomorrow — would your description still apply unchanged? If no, it's over-specified and wrong. Default to the SHORTEST description that names the lexical sense.
- Polysemy splits remain valid: "banco" (bench) vs "banco" (financial institution) are TRUE different senses encoded in the word itself. The forbidden move is shrinking a single sense into a context-narrow phrasing ("song of birds" instead of "song / singing").
- PARENTHETICALS — only morpho-grammatical tags are allowed: tense, person, mood, voice, aspect, reflexivity, formality. Examples of ALLOWED parens: "(subjunctive perfect)", "(reflexive)", "(simple past, 3rd person)", "(near future)", "(formal)". CONTEXT/TOPIC parens are FORBIDDEN — never emit "(in sports context)", "(in a rural area)", "(catching fish for food)", "(as a sport)", "(of birds)", "(on the beach)", "(about teammates)", "(skillful play)", "(of gameplay)". Decision test before writing a parenthetical: does the parenthetical name a grammatical feature of the word (tense, mood, person)? If yes → keep. Does it name a TOPIC or DOMAIN where this word happens to appear? If yes → DELETE the parenthetical AND any topic words from the main description. Polysemy splits are expressed by writing two genuinely different short phrases ("financial institution" vs "long bench to sit on"), NEVER by appending "(financial)" or "(bench)" tags.

Worked examples:
  "banco" in "el «banco» está cerrado los domingos"          → "financial institution"
  "banco" in "me senté en el «banco» del parque"             → "long bench to sit on"
  "fuego" in "encendió el «fuego» en la chimenea"            → "literal fire / flame"
  "fuego" in "siento un «fuego» dentro al verla"             → "passionate intensity / inner fire"
  "hoja" in "la «hoja» se cayó del árbol en otoño"           → "leaf of a plant"
  "hoja" in "necesito una «hoja» de papel"                   → "sheet of paper"
  "hoja" in "la «hoja» del cuchillo está afilada"            → "blade of a cutting tool"
  "comer" in "vamos a «comer» pasta"                         → "to eat"
  "Madrid" in "vivo en «Madrid» desde hace cinco años"       → "Madrid, capital of Spain"
  "Coca-Cola" in "una «Coca-Cola» fría"                      → "Coca-Cola, soft drink brand"
  Multi-word segment examples (note: every clitic / particle is preserved):
  "te haya impresionado" in "un partido que te «haya» impresionado" → "has impressed you (subjunctive perfect)"
  "darse cuenta" in "no se «dio» cuenta del error"           → "to realise / become aware (reflexive)"
  "echar de menos" in "te «echo» de menos"                   → "to miss (someone or something absent)"
  "se lo dijo" in "ya «se» lo dijo a su madre"               → "told it to him/her (already)"
  "voy a hacer" in "«voy» a hacer la cena"                   → "going to do / make (near future)"

Anti-examples — these are CONTEXT-LEAK failures. The bad version pulls vocabulary from the surrounding clause into the description; the good version stays at the word's lexical level:
  "canto" in "el «canto» de los pájaros"                     → ❌ "song or call of birds"           ✅ "song / singing / chant"
  "pesca" in "la «pesca» en el río"                          → ❌ "catching fish for food"           ✅ "fishing"
  "buceo" in "fuimos a hacer «buceo»"                        → ❌ "underwater diving as a sport"     ✅ "scuba diving / underwater diving"
  "olas" in "las «olas» chocaban con la playa"               → ❌ "waves in the sea"                 ✅ "waves (of water)"
  "tranquilidad" in "la «tranquilidad» del océano"           → ❌ "calmness of the ocean"            ✅ "calmness / tranquility"
  "encontrar" in "no podía «encontrar» a sus compañeros"     → ❌ "to find or locate teammates"      ✅ "to find / locate"
  "sutil" in "un toque «sutil» del defensa"                  → ❌ "delicate touch in defense"        ✅ "subtle / delicate"
  "aporta" in "la música «aporta» una sensación de paz"      → ❌ "provides a feeling of peace"      ✅ "to provide / contribute / bring"
  "sonido" in "el «sonido» del viento"                       → ❌ "sound produced by nature"         ✅ "sound"
  "juego" in "leer el «juego» del rival"                     → ❌ "game / play (in sports context)"  ✅ "game / play"
  "pesca" in "salimos de «pesca» temprano en el río"         → ❌ "fishing (catching fish for food)"  ✅ "fishing"
  "cabaña" in "alquilamos una «cabaña» en la montaña"        → ❌ "small house in a rural area"        ✅ "small house / cabin / hut"
  "estilo" in "su «estilo» de juego es ofensivo"             → ❌ "style of play / gameplay"          ✅ "style"
  "toque" in "un «toque» sutil del defensa"                  → ❌ "subtle touch / skillful play"      ✅ "touch / light touch"
  "le dio" in "le «dio» la libertad de jugar"                → ❌ "to give (someone) freedom to act"  ✅ "gave (simple past, 3rd person)"
  "comer" in "vamos a «comer» pasta"                         → ❌ "to eat (food, meal)"               ✅ "to eat"

Word: "${args.target_word}"
Context: "${context}"

Return ONLY the description string. No JSON, no quotes, no explanation.`;

  const raw = await chatText({
    task: "chat_precise",
    label: "vocab/describe",
    systemPrompt: prompt,
    temperature: 0,
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

// VocabJudgement — verdict for an SRS commit. Recognition mode now uses
// self-judging in the UI (user picks Falsch / Richtig after revealing
// the answer), so only "1" and "0" are emitted from that flow. "X" is
// kept for the sentence-mode judge (lib/vocabSentenceJudge.ts), which
// still produces three-way verdicts the SRS code treats as no-ops.
export type VocabJudgement = "1" | "X" | "0";

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
