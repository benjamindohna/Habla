// Generates TTS audio for a vocab card. Used by:
//   - /api/vocab/tts (cache-aware: hit → return blob from DB; miss → generate + persist + return)
//   - vocabSave async pre-generation (right after insert)
//   - scripts/backfillVocabAssets.ts
//
// Default speed 0.9× — single words / short phrases sound clearer at
// slightly slower-than-natural rate. The per-language accent guidance
// comes from lib/promptExamples.ts (Castellano for Spanish, standard
// metropolitan for French, etc.). The "include every clause / don't
// truncate" rule from the chat path is dropped because vocab inputs
// are short enough that truncation isn't a risk.

import { getOpenAI, TASK_MODELS, logAudioUsage } from "./llm";
import { getPromptExamples } from "./promptExamples";
import type { TargetLanguageSpec } from "./targetLanguage";

export async function generateTts(
  text: string,
  targetLanguage: TargetLanguageSpec,
  speed: number = 0.9,
): Promise<Buffer> {
  const speech = await getOpenAI().audio.speech.create({
    model: TASK_MODELS.tts,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    voice: "marin" as any,
    input: text,
    speed,
    instructions: getPromptExamples(targetLanguage).ttsInstructions,
  });

  const buffer = Buffer.from(await speech.arrayBuffer());

  logAudioUsage("vocab/tts", TASK_MODELS.tts, {
    inputChars: text.length,
    outputBytes: buffer.length,
  });

  return buffer;
}
