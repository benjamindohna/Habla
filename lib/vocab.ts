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
  const prompt = `You are generating a sense-key for a vocabulary entry. The learner is studying ${args.target_language}; their native language is ${args.native_language}. They have just tapped a word in a ${args.target_language} sentence.

Write a SHORT English description (3-7 words) of the SPECIFIC SENSE the tapped word has in this sentence. The description is used as a sense-key: it must be precise enough that two genuinely different meanings of the same word produce noticeably different descriptions, but generic enough that two synonymous translations of the same meaning produce IDENTICAL descriptions.

Rules:
- 3 to 7 words. No leading article. No trailing period.
- Describe the meaning, not the form (do not write tense / number).
- Be neutral about register / dialect.

Worked examples:
  "banco" in "el banco está cerrado los domingos"        → "financial institution"
  "banco" in "me senté en el banco del parque"           → "long bench to sit on"
  "fuego" in "encendió el fuego en la chimenea"          → "literal fire / flame"
  "fuego" in "siento un fuego dentro al verla"           → "passionate intensity / inner fire"
  "hoja" in "la hoja se cayó del árbol en otoño"         → "leaf of a plant"
  "hoja" in "necesito una hoja de papel"                 → "sheet of paper"
  "hoja" in "la hoja del cuchillo está afilada"          → "blade of a cutting tool"
  "comer" in "vamos a comer pasta"                       → "to eat (food, meal)"
  "Madrid" in "vivo en Madrid desde hace cinco años"     → "Madrid (city, capital of Spain)"
  "Coca-Cola" in "una Coca-Cola fría"                    → "Coca-Cola (the soft drink brand)"

Word: "${args.target_word}"
Context: "${args.context_sentence}"

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
