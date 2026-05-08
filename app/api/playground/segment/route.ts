import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { generateAndSegmentOpener } from "@/lib/aiBubblePipeline";

/**
 * Test-only endpoint exercising the new two-call AI-bubble pipeline:
 *   Call A: generate opener text only
 *   Call B: translate + segment + align
 *
 * Returns { text, native_translation, segments } so the playground UI can
 * render the bubble and show the full native translation as a debug aid.
 *
 * Auth-gated like every other route — uses the user's level + native
 * language so the test is realistic.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const user = getUserById(session.userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { topic?: unknown };
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic) {
    return NextResponse.json({ error: "topic required" }, { status: 400 });
  }

  try {
    const result = await generateAndSegmentOpener({
      topic,
      level: user.level,
      nativeLanguage: user.nativeLanguage,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/playground/segment]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
