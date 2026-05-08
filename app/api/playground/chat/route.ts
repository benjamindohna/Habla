import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { chatText } from "@/lib/llm";

/**
 * Single-shot sandbox for ad-hoc gpt-4o-mini calls. No history, no system
 * prompt, no app-specific framing — just send the message, get a reply.
 * Every call is a fresh context.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { message?: unknown };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  try {
    const response = await chatText({
      task: "chat_light",
      label: "playground/chat",
      userPrompt: message,
      temperature: 0.7,
    });
    return NextResponse.json({ response });
  } catch (err) {
    console.error("[/api/playground/chat]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
