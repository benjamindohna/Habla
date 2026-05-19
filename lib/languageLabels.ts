// UI labels for language names, localised into the user's native
// language. Used wherever the app needs to show "Spanish" / "French"
// (English keys, how they're stored in the DB) as something a learner
// reads naturally — "Spanisch" / "Französisch" for a German-native
// user. Independent of describeTargetLanguage(), which produces the
// long English label for prompts.
//
// Today only German-native labels are populated. To support other
// native languages later, add more outer keys here. If a label is
// missing the function falls back to the raw English name — safe,
// just less polished.

const LABEL_TABLE: Record<string, Record<string, string>> = {
  German: {
    Spanish: "Spanisch",
    French: "Französisch",
    Italian: "Italienisch",
    English: "Englisch",
    Portuguese: "Portugiesisch",
    German: "Deutsch",
  },
};

/**
 * Localised display name for `languageName` (e.g. "Spanish") rendered
 * into `nativeLanguage` (e.g. "German" → "Spanisch"). Falls back to the
 * raw English name if no translation table covers it.
 */
export function languageLabel(languageName: string, nativeLanguage: string): string {
  return LABEL_TABLE[nativeLanguage]?.[languageName] ?? languageName;
}
