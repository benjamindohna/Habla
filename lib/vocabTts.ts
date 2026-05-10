// Generates TTS audio for a vocab card. Used by:
//   - /api/vocab/tts (cache-aware: hit → return blob from DB; miss → generate + persist + return)
//   - vocabSave async pre-generation (right after insert)
//   - scripts/backfillVocabAssets.ts
//
// Default speed 0.9× — single words / short phrases sound clearer at
// slightly slower-than-natural rate. The Castellano accent guidance is
// a condensed version of the chat /api/tts instructions; the
// "include every clause / don't truncate" rule from the chat path is
// dropped because vocab inputs are short enough that truncation isn't
// a risk.

import { getOpenAI, TASK_MODELS, logAudioUsage } from "./llm";

export async function generateTts(text: string, speed: number = 0.9): Promise<Buffer> {
  const speech = await getOpenAI().audio.speech.create({
    model: TASK_MODELS.tts,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    voice: "marin" as any,
    input: text,
    speed,
    instructions:
      `Pronounce the Spanish word or phrase clearly, at a natural pace suitable for a learner. ` +
      `Use a clear Castilian (Castellano, peninsular Spanish) accent — the distinción: pronounce "c" before e or i, and "z", as the /θ/ sound (the "th" in English "thin"). Concrete examples: Barcelona → "Barthelona", cinco → "thinco", zapato → "thapato", gracias → "grathias". ` +
      `Use Iberian intonation — crisp consonants, the typical Madrid/Castilla cadence. Friendly and clear, not declamatory.`,
  });

  const buffer = Buffer.from(await speech.arrayBuffer());

  logAudioUsage("vocab/tts", TASK_MODELS.tts, {
    inputChars: text.length,
    outputBytes: buffer.length,
  });

  return buffer;
}
