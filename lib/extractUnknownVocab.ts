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

Prefer single words. Group into a short phrase only when the meaning depends on the unit (fixed expression like "tener ganas", "por ejemplo", compound verbs like "darse cuenta"). Always use the form as it appears in the CORRECT VERSION — that's the lemma the learner needs to learn.

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
