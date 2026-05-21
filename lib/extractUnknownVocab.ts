// Auto-extract vocab the learner likely doesn't know yet from a single
// correction turn. Runs server-side as a fire-and-forget side effect of
// /api/correct: given the raw transcript, our interpretation of what
// they meant, and the perfect target-language version, an LLM picks
// out content words the learner clearly struggled with. Each extracted
// word is then fed through the existing saveVocabEntry pipeline, which
// handles description generation, dedup against the user's existing
// vocab (synonym vs polysemy decision via comparator LLM), and SRS
// initialisation.
//
// Cost shape per user turn: 1 small LLM call here + 0..N saveVocabEntry
// calls (each ~$0.00006 typical). The extractor is asked for max 5
// entries to keep the upper bound predictable.

import { chatJSON } from "./llm";
import { saveVocabEntry } from "./vocabSave";
import { describeTargetLanguage, type TargetLanguageSpec } from "./targetLanguage";

interface ExtractArgs {
  transcript: string;
  interpretation: string;
  localVersionTarget: string;
  nativeLanguage: string;
  targetLanguage: TargetLanguageSpec;
}

interface ExtractionResult {
  unknown_words: string[];
}

function buildPrompt(args: ExtractArgs): string {
  const target = describeTargetLanguage(args.targetLanguage);
  return `You are a vocabulary-extraction engine for language learning.

A learner is practising ${target}. After one spoken turn, we have three views of the same idea:

RAW TRANSCRIPT (what the learner actually said — may contain ${args.nativeLanguage} fallbacks, wrong words, mangled forms, or drops):
"${args.transcript}"

INTERPRETATION (what they meant, expressed in their native ${args.nativeLanguage}):
"${args.interpretation}"

CORRECT VERSION (the perfect ${target} sentence we corrected them toward):
"${args.localVersionTarget}"

Your job: identify content words or short phrases from the CORRECT VERSION that the learner most likely does NOT yet know. We will add these to their personal vocab deck for later practice.

A word/phrase is UNKNOWN when at least one of these is clearly true:
- The learner substituted a ${args.nativeLanguage} word in its place ("Freunde" instead of "amigos")
- The learner used a wrong target-language word with the wrong meaning
- The learner dropped the word entirely, and it was central to the meaning
- The learner mangled it so badly they likely don't know the lemma (not just a conjugation slip)

A word/phrase is NOT unknown when:
- The learner used it correctly in any form (even with a minor grammar/conjugation error of a clearly-known word)
- It is a function word: preposition, article, conjunction, basic pronoun — skip these even if missing
- It is a proper noun (names of people, brands, cities)
- It is a number or trivial filler

Prefer single words. Group into a short phrase only when the meaning depends on the unit (fixed expression like "tener ganas", "por ejemplo", compound verbs like "darse cuenta", contrastive conjunctions like "mientras que", verb+noun idioms like "llamar la atención"). Always use the form as it appears in the CORRECT VERSION — that's the lemma the learner needs to learn.

═════ WORKED EXAMPLES (Spanish target, German native — rules apply to any language pair) ═════

EXAMPLE 1 — content noun substituted with native word (extract the target noun):
TRANSCRIPT:  "Voy al Schreibtisch para trabajar."
INTERPRETATION: "Ich gehe zum Schreibtisch um zu arbeiten."
CORRECT: "Voy al escritorio para trabajar."
unknown_words: ["escritorio"]

EXAMPLE 2 — phrasal trap, must save WHOLE phrase not the bare conjunction:
TRANSCRIPT:  "Las tapas son pequeñas, mientras los antipasti son aperitivos."
INTERPRETATION: "Tapas sind klein, wohingegen Antipasti Aperitifs sind."
CORRECT: "Las tapas son porciones pequeñas, mientras que los antipasti son aperitivos."
unknown_words: ["mientras que"]
  ✗ NEVER "que" alone — "que" by itself has no contrastive sense; the
  contrastive meaning lives in the phrase "mientras que". Saving the
  bare conjunction would create a card whose sense the word can't
  actually carry alone.

EXAMPLE 3 — function word dropped, but still SKIP it (no card):
TRANSCRIPT:  "Voy cine ahora."
INTERPRETATION: "Ich gehe jetzt ins Kino."
CORRECT: "Voy al cine ahora."
unknown_words: []
  The contracted article "al" was missing, but articles are function
  words — skip even when missing. The learner doesn't need a vocab
  card for "al"; they need exposure.

EXAMPLE 4 — verb+noun idiom, save the FULL idiom unit:
TRANSCRIPT:  "¿Hay una jugada que te haya llamado en los videos?"
INTERPRETATION: "Gibt es eine Spielszene, die dir in den Videos aufgefallen ist?"
CORRECT: "¿Hay alguna jugada que te haya llamado la atención en los videos?"
unknown_words: ["llamar la atención"]
  ✗ NEVER "te haya llamado" alone — without "la atención" the phrase
  reverts to literal "called you". The idiomatic "catch attention"
  sense only exists in the full unit "llamar la atención". Use the
  infinitive form ("llamar"), not the conjugated form, because that's
  the lemma the learner will encounter again across tenses.

EXAMPLE 5 — fully correct, nothing to learn:
TRANSCRIPT:  "Tengo mucha hambre hoy."
INTERPRETATION: "Ich habe heute großen Hunger."
CORRECT: "Tengo mucha hambre hoy."
unknown_words: []

═════ OUTPUT ═════

Output ONLY valid JSON, no commentary:
{ "unknown_words": ["word", "another word", "fixed phrase"] }

Hard cap: at most 5 entries. If the learner clearly knew everything, return { "unknown_words": [] }.`;
}

export async function extractUnknownVocab(args: ExtractArgs): Promise<string[]> {
  const result = await chatJSON<ExtractionResult>({
    task: "chat_light",
    label: "extract-unknown-vocab",
    userPrompt: buildPrompt(args),
  });
  const words = Array.isArray(result?.unknown_words) ? result.unknown_words : [];
  return words
    .map((w) => (typeof w === "string" ? w.trim() : ""))
    .filter((w) => w.length > 0)
    .slice(0, 5);
}

interface AutoSaveArgs extends ExtractArgs {
  userId: number;
}

// Fire-and-forget orchestrator. Runs the extractor, then saves each
// candidate word through the standard saveVocabEntry pipeline (which
// handles the dedup-against-existing-rows decision via the comparator
// LLM). Errors are logged, never thrown — this is a background
// enrichment, not a critical path.
export async function autoSaveUnknownVocab(args: AutoSaveArgs): Promise<void> {
  let words: string[] = [];
  try {
    words = await extractUnknownVocab({
      transcript: args.transcript,
      interpretation: args.interpretation,
      localVersionTarget: args.localVersionTarget,
      nativeLanguage: args.nativeLanguage,
      targetLanguage: args.targetLanguage,
    });
  } catch (err) {
    console.error("[autoSaveUnknownVocab] extraction failed", err);
    return;
  }

  if (words.length === 0) return;

  // Save in parallel — each call is independent and idempotent
  // (dedup happens inside saveVocabEntry against the user's existing
  // rows for the same target_word_lower).
  const results = await Promise.allSettled(
    words.map((word) =>
      saveVocabEntry({
        userId: args.userId,
        segment: word,
        context_sentence: args.localVersionTarget,
        native_language: args.nativeLanguage,
        targetLanguage: args.targetLanguage,
      }),
    ),
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "rejected") {
      console.error(`[autoSaveUnknownVocab] save failed for "${words[i]}"`, r.reason);
    }
  }
}
