// Canonicalisation pipeline for vocabulary entries (target_word,
// native_translation). Implements the rules in ROADMAP.md §1
// "Vocabulary canonicalisation". Stub-friendly: the LLM-backed casing /
// proper-noun classifier is injected so the unit tests can run without
// network calls.
//
// Out of scope for this module: the SRS save logic (Step 1/2/3 lookup +
// polysemy classification). That comes in a later phase and lives separately.

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
