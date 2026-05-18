// Per-language data tables that prompts pull their language-specific
// bits from. The static SCAFFOLDING of each prompt (rules, structure,
// decision tree) stays in the prompt-builder file; only the EXAMPLES
// and lexical lists live here, keyed by target language.
//
// Pattern: every prompt-builder that has Spanish-specific text gets a
// matching language-keyed entry below. Spanish entries hold today's
// content; French entries hold parallel content with adapted examples.

import type { TargetLanguageSpec } from "./targetLanguage";

export interface PromptExamples {
  /** Verbs that slot into the chat-empty-state greeting frame
   *  "¿De qué quieres ___ hoy?" / "De quoi veux-tu ___ aujourd'hui ?".
   *  Curated so each option reads naturally in the frame. */
  greetingVerbs: readonly string[];
  /** Renders the full greeting sentence given a picked verb. The frame
   *  itself differs per language (punctuation, word order). */
  greetingFrame: (verb: string) => string;
  /** Native articles + indefinite articles, lowercased. Used by the
   *  on-tap translate prompt to know which articles to bundle with the
   *  following noun, and by the sentence judge for article-tolerance. */
  articles: readonly string[];
}

const SPANISH: PromptExamples = {
  greetingVerbs: [
    "hablar",
    "charlar",
    "conversar",
    "dialogar",
    "platicar",
    "parlotear",
    "cotillear",
    "chismorrear",
    "debatir",
    "comentar",
    "departir",
  ],
  greetingFrame: (verb) => `Hola, ¿de qué quieres ${verb} hoy?`,
  articles: ["el", "la", "los", "las", "un", "una", "unos", "unas"],
};

const FRENCH: PromptExamples = {
  greetingVerbs: [
    "parler",
    "bavarder",
    "discuter",
    "causer",
    "converser",
    "papoter",
    "débattre",
    "échanger",
    "deviser",
  ],
  greetingFrame: (verb) => `Salut, de quoi veux-tu ${verb} aujourd'hui ?`,
  articles: ["le", "la", "les", "l'", "un", "une", "des"],
};

const PROMPT_EXAMPLES_BY_LANGUAGE: Record<string, PromptExamples> = {
  Spanish: SPANISH,
  French: FRENCH,
};

/**
 * Lookup the example/data set for the given target language. Falls back
 * to Spanish for any unknown language — the prompts then read the
 * Spanish data, which is still valid scaffolding (the LLM generalises).
 */
export function getPromptExamples(spec: TargetLanguageSpec): PromptExamples {
  return PROMPT_EXAMPLES_BY_LANGUAGE[spec.language] ?? SPANISH;
}
