import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { text, speed } = (await req.json()) as { text: string; speed?: number };

    if (!text?.trim()) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      voice: "marin" as any,
      input: text,
      speed: speed ?? 1.0,
    });

    const buffer = Buffer.from(await speech.arrayBuffer());

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
