import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { toFile } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioBlob = formData.get("audio") as Blob | null;
    const nativeLanguage = (formData.get("nativeLanguage") as string | null) ?? "English";

    if (!audioBlob) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    const arrayBuffer = await audioBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log("[/api/transcribe] blob size:", buffer.length, "type:", audioBlob.type, "nativeLanguage:", nativeLanguage);

    // Prompt tells Whisper to expect mixed Spanish + native language so it
    // doesn't force-map native-language words into Spanish phonetics.
    // temperature: 0 suppresses hallucinated filler phrases.
    const transcription = await openai.audio.transcriptions.create({
      file: await toFile(buffer, "audio.webm", { type: audioBlob.type || "audio/webm" }),
      model: "gpt-4o-transcribe",
      prompt: `The speaker is learning Spanish and may mix in ${nativeLanguage} words they don't know in Spanish yet. Transcribe exactly what is said, preserving both Spanish and ${nativeLanguage} words as spoken. Always write numbers as words, never as digits.`,
    });

    console.log("[/api/transcribe] transcript:", JSON.stringify(transcription.text));
    return NextResponse.json({ transcript: transcription.text });
  } catch (err) {
    console.error("[/api/transcribe]", err);
    return NextResponse.json({ error: "Transcription failed" }, { status: 500 });
  }
}
