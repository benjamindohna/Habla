import { NextRequest, NextResponse } from "next/server";
import { toFile } from "openai";
import { getOpenAI, TASK_MODELS, logAudioUsage } from "@/lib/llm";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { withRouteUsage } from "@/lib/usageContext";

export async function POST(req: NextRequest) {
  return withRouteUsage("/api/transcribe", async () => {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const user = await getUserById(session.userId);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const formData = await req.formData();
    const audioBlob = formData.get("audio") as Blob | null;
    const nativeLanguage = (formData.get("nativeLanguage") as string | null) ?? "English";

    if (!audioBlob) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    const arrayBuffer = await audioBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Prompt tells Whisper to expect mixed target + native language so it
    // doesn't force-map native-language words into target-language phonetics.
    const targetName = user.targetLanguage.language;
    const transcription = await getOpenAI().audio.transcriptions.create({
      file: await toFile(buffer, "audio.webm", { type: audioBlob.type || "audio/webm" }),
      model: TASK_MODELS.transcription,
      prompt: `The speaker is learning ${targetName} and may mix in ${nativeLanguage} words they don't know in ${targetName} yet. Transcribe exactly what is said, preserving both ${targetName} and ${nativeLanguage} words as spoken. Always write numbers as words, never as digits.`,
    });

    logAudioUsage("transcribe", TASK_MODELS.transcription, {
      inputBytes: buffer.length,
      outputChars: transcription.text.length,
    });

    return NextResponse.json({ transcript: transcription.text });
  } catch (err) {
    console.error("[/api/transcribe]", err);
    return NextResponse.json({ error: "Transcription failed" }, { status: 500 });
  }
  });
}
