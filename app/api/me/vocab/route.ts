import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { saveVocabEntry } from "@/lib/vocabSave";
import { getDb } from "@/lib/db";

/**
 * Save a vocab entry. The AIBubble fires this fire-and-forget after
 * each first tap on a word. The body carries:
 *   - segment: the target-language segment to save (multi-word if
 *     the on-tap LLM grouped it; single word otherwise). The client
 *     uses the result.segment from /api/playground/translate or its
 *     production successor.
 *   - context: the AI message the segment was tapped in, used by the
 *     description generator.
 *
 * Returns a SaveVocabResult — useful for client-side feedback and
 * for the playground save-test view.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const user = getUserById(session.userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    segment?: unknown;
    context?: unknown;
    wordIndex?: unknown;
  };
  const segment = typeof body.segment === "string" ? body.segment.trim() : "";
  const context = typeof body.context === "string" ? body.context.trim() : "";
  const wordIndex =
    typeof body.wordIndex === "number" && Number.isInteger(body.wordIndex) && body.wordIndex >= 0
      ? body.wordIndex
      : undefined;
  if (!segment || !context) {
    return NextResponse.json({ error: "segment and context required" }, { status: 400 });
  }

  try {
    const result = await saveVocabEntry({
      userId: user.id,
      segment,
      context_sentence: context,
      tapped_word_index: wordIndex,
      native_language: user.nativeLanguage,
      targetLanguage: user.targetLanguage,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/me/vocab POST]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * List all vocab rows for the current user. Used by the playground
 * save-test page so the user can see what they've stored. Production
 * "manage my vocab" UI will use this too.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rows = getDb()
    .prepare(
      `SELECT id, target_word_original, target_word_lower, english_description,
              context_sentence, stage, stage_sentence, next_due_at, correct_streak,
              looked_up, last_seen, created_at, relevance_rank
       FROM user_vocab
       WHERE user_id = ?
       ORDER BY relevance_rank ASC, id ASC`,
    )
    .all(session.userId);
  return NextResponse.json({ rows });
}

/**
 * Delete a single vocab row for the current user. Used by the
 * playground save-test for quick cleanup during testing, and the
 * eventual manage-my-vocab UI for actual mistakes.
 */
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(req.url);
  const idStr = url.searchParams.get("id");
  const id = idStr ? Number(idStr) : NaN;
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const result = getDb()
    .prepare("DELETE FROM user_vocab WHERE id = ? AND user_id = ?")
    .run(id, session.userId);
  if (result.changes === 0) {
    return NextResponse.json({ error: "row not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, deleted: id });
}
