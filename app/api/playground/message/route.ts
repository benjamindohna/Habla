import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { generateAIOpener } from "@/lib/aiBubblePipeline";

/**
 * Playground Call A: produce only the AI's opener text. No segmentation,
 * no per-word translations. Cheap, single focus.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { topic?: unknown };
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic) {
    return NextResponse.json({ error: "topic required" }, { status: 400 });
  }

  try {
    const text = await generateAIOpener({
      topic,
      level: user.level,
      nativeLanguage: user.nativeLanguage,
      targetLanguage: user.targetLanguage,
    });
    return NextResponse.json({ text });
  } catch (err) {
    console.error("[/api/playground/message]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
