import { NextRequest, NextResponse } from "next/server";
import { getOpenAI, TASK_MODELS, logAudioUsage } from "@/lib/llm";
import { DEFAULT_TARGET, describeTargetLanguage } from "@/lib/targetLanguage";

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
      // Explicit coverage instruction — gpt-4o-mini-tts occasionally drops
      // trailing clauses on multi-sentence input. Telling it to read the full
      // text appears to reduce that.
      instructions:
        `Read the entire ${DEFAULT_TARGET.language} text from start to finish, exactly as written. ` +
        `Speak in a natural, friendly conversational tone — like a ${describeTargetLanguage(DEFAULT_TARGET)} native speaker. ` +
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
