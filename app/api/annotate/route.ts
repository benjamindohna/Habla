import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { withRouteUsage } from "@/lib/usageContext";
import { getUserById } from "@/lib/users";
import { getOrCreateAnnotation } from "@/lib/annotate";

/**
 * Whole-sentence annotation for the tap-lookup flow. The client calls
 * this once per displayed text (fire-and-forget on render); taps then
 * resolve locally against the returned spans. Cache-aware end to end:
 * in-flight dedup + the global sentence_annotations table mean repeat
 * requests — same user or any other user — cost no LLM call.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  return withRouteUsage("/api/annotate", session?.userId ?? null, async () => {
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const user = await getUserById(session.userId);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const body = (await req.json().catch(() => ({}))) as { text?: string };
    if (typeof body.text !== "string" || !body.text.trim()) {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }
    // Guard against runaway inputs — bubbles are 1–3 sentences; anything
    // beyond ~1200 chars is not a legitimate lookup surface.
    if (body.text.length > 1200) {
      return NextResponse.json({ error: "text too long" }, { status: 400 });
    }

    try {
      const annotation = await getOrCreateAnnotation({
        text: body.text,
        nativeLanguage: user.nativeLanguage,
        targetLanguage: user.targetLanguage,
      });
      return NextResponse.json(annotation);
    } catch (err) {
      console.error("[/api/annotate]", err);
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
