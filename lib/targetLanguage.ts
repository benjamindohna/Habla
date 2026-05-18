// The learner's target language as a composable spec. Each user has
// their own spec stored in the DB (target_language_json column).
//
// Prompts use `describeTargetLanguage(spec)` to render a phrase like
// "everyday Castellano Spanish" or "everyday French" for inline use
// in prompt text.
//
// Code MUST NOT import a global default to fill prompt-level decisions
// — every prompt-creating function receives the user's spec as a
// function argument, threaded from the session. `INITIAL_TARGET_SEED`
// below is used only for DB column defaults and seed-script bootstrap
// (i.e., the value applied at user creation when nothing else is
// available).

export type LanguageStyle = "everyday" | "street" | "office";

export interface TargetLanguageSpec {
  /** Bare language name, e.g. "Spanish", "Hungarian". Used in prompts where
   *  the bare language reads better than the full description (e.g. "may
   *  mix in {nativeLanguage} for words they don't know in Spanish"). */
  language: string;
  /** Regional variant key. Null for languages with no meaningful regional
   *  split. For Spanish: "castellano" | "neutral" | "latino". For French:
   *  always null today (could later be "metropolitan" | "canadian"). */
  location: string | null;
  /** Register / register-flavour. */
  style: LanguageStyle;
}

/**
 * Used ONLY as the value applied to brand-new users / DB column default
 * — never imported by prompt-creating code, which must receive a spec
 * via function argument from the session user.
 */
export const INITIAL_TARGET_SEED: TargetLanguageSpec = {
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
  French: {
    metropolitan: "metropolitan",
    canadian: "Québécois",
  },
};

/**
 * Short composable label, e.g. "everyday Castellano Spanish" or
 * "everyday French" (when location is null). Used inline in prompts.
 */
export function describeTargetLanguage(spec: TargetLanguageSpec): string {
  const parts: string[] = [STYLE_PHRASE[spec.style] ?? spec.style];

  if (spec.location) {
    const phrase = LOCATION_PHRASE_BY_LANGUAGE[spec.language]?.[spec.location] ?? spec.location;
    parts.push(phrase);
  }

  parts.push(spec.language);
  return parts.join(" ");
}

/**
 * Parse the JSON stored in `users.target_language_json`. Fails open to
 * INITIAL_TARGET_SEED if the column ever contains garbage — better to
 * default to Spanish than crash a chat request.
 */
export function parseTargetLanguageSpec(raw: string | null | undefined): TargetLanguageSpec {
  if (!raw) return INITIAL_TARGET_SEED;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.language === "string" &&
      (parsed.location === null || typeof parsed.location === "string") &&
      (parsed.style === "everyday" || parsed.style === "street" || parsed.style === "office")
    ) {
      return {
        language: parsed.language,
        location: parsed.location ?? null,
        style: parsed.style,
      };
    }
  } catch {
    // fallthrough
  }
  return INITIAL_TARGET_SEED;
}

/**
 * Bare language name only — convenience for prompts/strings that just
 * need "Spanish" / "French" without the variant/style qualifiers.
 */
export function targetLanguageName(spec: TargetLanguageSpec): string {
  return spec.language;
}
