import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { generateTts } from "@/lib/vocabTts";

/**
 * Returns the TTS audio for a vocab card's target word. Cache-aware:
 * cached blob → return directly (~5 ms). Cache miss → generate via
 * OpenAI TTS, persist on the row, return.
 *
 * Response is audio/mpeg (NOT JSON). The client treats it as a blob
 * and plays it via the Audio API.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { rowId?: number };
  const { rowId } = body;
  if (typeof rowId !== "number" || !Number.isFinite(rowId) || rowId <= 0) {
    return NextResponse.json({ error: "rowId required" }, { status: 400 });
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, target_word_original, tts_audio
       FROM user_vocab WHERE id = ? AND user_id = ?`,
    )
    .get(rowId, session.userId) as
    | { id: number; target_word_original: string; tts_audio: Buffer | null }
    | undefined;
  if (!row) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  // Cache hit: serve the stored blob.
  if (row.tts_audio && row.tts_audio.length > 0) {
    return new NextResponse(new Uint8Array(row.tts_audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  }

  // Cache miss: generate, persist, return.
  try {
    const buffer = await generateTts(row.target_word_original);
    db.prepare(
      `UPDATE user_vocab SET tts_audio = ? WHERE id = ? AND user_id = ?`,
    ).run(buffer, row.id, session.userId);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[/api/vocab/tts]", err);
    return NextResponse.json({ error: "TTS generation failed" }, { status: 500 });
  }
}
