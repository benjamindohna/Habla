import { NextRequest, NextResponse } from "next/server";
import { getOpenAI, TASK_MODELS, logAudioUsage } from "@/lib/llm";

export async function POST(req: NextRequest) {
  try {
    const { text, speed } = (await req.json()) as { text: string; speed?: number };

    if (!text?.trim()) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const speech = await getOpenAI().audio.speech.create({
      model: TASK_MODELS.tts,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      voice: "marin" as any,
      input: text,
      speed: speed ?? 1.0,
      // Hardcoded to Castellano (peninsular) Spanish for now. The
      // distinción examples are deliberately concrete — without them the
      // model defaults to a neutral or seseo pronunciation.
      // The coverage clause (read the full text, no summarising) is here
      // because gpt-4o-mini-tts occasionally drops trailing clauses on
      // multi-sentence input. See BACKLOG: "TTS voice / accent — modular
      // per target language" for the planned per-language config.
      instructions:
        `Read the entire Spanish text from start to finish, exactly as written. ` +
        `Speak with a clear Castilian (Castellano, peninsular Spanish) accent — use the distinción: pronounce "c" before e or i, and "z", as the /θ/ sound (the "th" in English "thin"). Concrete examples: Barcelona sounds like "Barthelona", cinco like "thinco", zapato like "thapato", gracias like "grathias". ` +
        `Use Iberian intonation and rhythm — crisp consonants, the typical Madrid/Castilla cadence. Friendly, conversational, not declamatory. ` +
        `Include every clause, every sentence, every punctuation pause. ` +
        `Do not summarise, abbreviate, or truncate any part of the text.`,
    });

    const buffer = Buffer.from(await speech.arrayBuffer());

    logAudioUsage("tts", TASK_MODELS.tts, {
      inputChars: text.length,
      outputBytes: buffer.length,
    });

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[/api/tts]", err);
    return NextResponse.json({ error: "TTS generation failed" }, { status: 500 });
  }
}
