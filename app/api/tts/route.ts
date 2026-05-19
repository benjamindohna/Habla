import { NextRequest, NextResponse } from "next/server";
import { getOpenAI, TASK_MODELS, logAudioUsage } from "@/lib/llm";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { getPromptExamples } from "@/lib/promptExamples";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const user = await getUserById(session.userId);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const { text, speed } = (await req.json()) as { text: string; speed?: number };

    if (!text?.trim()) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    // Per-language accent instructions from promptExamples; plus the
    // coverage clause (read the full text, no summarising) appended
    // here because gpt-4o-mini-tts occasionally drops trailing clauses
    // on multi-sentence input.
    const accentBlock = getPromptExamples(user.targetLanguage).ttsInstructions;
    const coverageBlock =
      `Read the entire text from start to finish, exactly as written. ` +
      `Include every clause, every sentence, every punctuation pause. ` +
      `Do not summarise, abbreviate, or truncate any part of the text.`;

    const speech = await getOpenAI().audio.speech.create({
      model: TASK_MODELS.tts,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      voice: "marin" as any,
      input: text,
      speed: speed ?? 1.0,
      instructions: `${coverageBlock} ${accentBlock}`,
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
