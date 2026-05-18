import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { getDb } from "@/lib/db";
import { generateExplanation } from "@/lib/vocabExplain";

/**
 * Returns the row's native-language translation + hint. Cache-aware:
 * if the row already has both fields populated (pre-generated at insert
 * time or by the backfill script), they're returned directly with no
 * LLM call. Otherwise the prompt fires, and the result is written back
 * to the row before being returned — so the second call is always
 * cached.
 *
 * Stage / SRS state is NOT modified here. Stage update happens
 * separately via /api/vocab/commit when the user clicks Weiter.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const user = getUserById(session.userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { rowId?: number };
  const { rowId } = body;
  if (typeof rowId !== "number" || !Number.isFinite(rowId) || rowId <= 0) {
    return NextResponse.json({ error: "rowId required" }, { status: 400 });
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, target_word_original, context_sentence,
              native_translation, native_hint
       FROM user_vocab WHERE id = ? AND user_id = ?`,
    )
    .get(rowId, session.userId) as
    | {
        id: number;
        target_word_original: string;
        context_sentence: string | null;
        native_translation: string | null;
        native_hint: string | null;
      }
    | undefined;
  if (!row) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  // Cache hit: both fields populated → return directly.
  if (row.native_translation && row.native_hint !== null) {
    return NextResponse.json({
      translation: row.native_translation,
      hint: row.native_hint,
    });
  }

  // Cache miss: generate, persist, return.
  try {
    const result = await generateExplanation({
      target_word: row.target_word_original,
      context_sentence: row.context_sentence ?? "",
      targetLanguage: user.targetLanguage,
      native_language: user.nativeLanguage,
    });
    db.prepare(
      `UPDATE user_vocab SET native_translation = ?, native_hint = ?
       WHERE id = ? AND user_id = ?`,
    ).run(result.translation, result.hint, row.id, session.userId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/vocab/explain]", err);
    return NextResponse.json({ error: "Explain failed" }, { status: 500 });
  }
}
