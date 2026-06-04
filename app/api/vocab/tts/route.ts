import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { withRouteUsage } from "@/lib/usageContext";
import { getUserById } from "@/lib/users";
import { db } from "@/lib/db";
import { userVocab } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { generateTts } from "@/lib/vocabTts";

/**
 * Returns the TTS audio for a vocab card's target word. Cache-aware:
 * cached blob → return directly. Cache miss → generate via OpenAI TTS,
 * persist on the row, return.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  return withRouteUsage("/api/vocab/tts", session?.userId ?? null, async () => {
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { rowId?: number };
  const { rowId } = body;
  if (typeof rowId !== "number" || !Number.isFinite(rowId) || rowId <= 0) {
    return NextResponse.json({ error: "rowId required" }, { status: 400 });
  }

  const rows = await db
    .select({
      id: userVocab.id,
      targetWordOriginal: userVocab.targetWordOriginal,
      ttsAudio: userVocab.ttsAudio,
    })
    .from(userVocab)
    .where(and(eq(userVocab.id, rowId), eq(userVocab.userId, session.userId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  if (row.ttsAudio && row.ttsAudio.length > 0) {
    return new NextResponse(new Uint8Array(row.ttsAudio), {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  }

  try {
    const buffer = await generateTts(row.targetWordOriginal, user.targetLanguage);
    await db
      .update(userVocab)
      .set({ ttsAudio: buffer })
      .where(and(eq(userVocab.id, row.id), eq(userVocab.userId, session.userId)));
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[/api/vocab/tts]", err);
    return NextResponse.json({ error: "TTS generation failed" }, { status: 500 });
  }
  });
}
