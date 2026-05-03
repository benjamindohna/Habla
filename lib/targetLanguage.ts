// Defines the learner's target language as a composable spec. Prompts use
// `describeTargetLanguage()` to render a phrase like "everyday Castellano
// Spanish" — or "casual / youth Hungarian" when the language has no regional
// variants.
//
// For now there's a single hard-coded DEFAULT_TARGET used by every prompt.
// Making this per-user is in BACKLOG.md.

export type LanguageStyle = "everyday" | "street" | "office";

export interface TargetLanguageSpec {
  /** Bare language name, e.g. "Spanish", "Hungarian". Used in prompts where
   *  the bare language reads better than the full description (e.g. "may
   *  mix in {nativeLanguage} for words they don't know in Spanish"). */
  language: string;
  /** Regional variant key. Null for languages with no meaningful regional
   *  split (Hungarian, Japanese). For Spanish: "castellano" | "neutral" |
   *  "latino". */
  location: string | null;
  /** Register / register-flavour. */
  style: LanguageStyle;
}

export const DEFAULT_TARGET: TargetLanguageSpec = {
  language: "Spanish",
  location: "castellano",
  style: "everyday",
};

const STYLE_PHRASE: Record<LanguageStyle, string> = {
  everyday: "everyday",
  street: "casual / youth",
  office: "professional / office",
};

// Per-language location label tables. Adding a new language? Add a table
// here and the resolver picks the matching one. Locations not found fall
// back to the raw key — safe but not pretty.
const LOCATION_PHRASE_BY_LANGUAGE: Record<string, Record<string, string>> = {
  Spanish: {
    castellano: "Castellano",
    neutral: "neutral pan-regional",
    latino: "Latin American",
  },
};

/**
 * Short composable label, e.g. "everyday Castellano Spanish" or
 * "casual / youth Hungarian" (when location is null). Used inline in
 * prompts where you'd otherwise hard-code "Spanish".
 */
export function describeTargetLanguage(spec: TargetLanguageSpec = DEFAULT_TARGET): string {
  const parts: string[] = [STYLE_PHRASE[spec.style] ?? spec.style];

  if (spec.location) {
    const phrase = LOCATION_PHRASE_BY_LANGUAGE[spec.language]?.[spec.location] ?? spec.location;
    parts.push(phrase);
  }

  parts.push(spec.language);
  return parts.join(" ");
}
