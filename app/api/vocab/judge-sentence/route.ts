import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { getDb } from "@/lib/db";
import { judgeVocabSentence } from "@/lib/vocabSentenceJudge";
import { DEFAULT_TARGET } from "@/lib/targetLanguage";

/**
 * Production-mode judge endpoint. The learner has typed a sentence
 * using the target word; this routes the sentence through the
 * sentence-specific LLM judge and returns the verdict.
 *
 * Stage / SRS state is NOT modified here — the client commits the
 * verdict via /api/vocab/commit when the attempt cycle terminates
 * (success or give-up after 3 X). Same pattern as the recognition
 * judge, so retries don't cascade-halve the stage.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const user = getUserById(session.userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    rowId?: number;
    userSentence?: string;
  };
  const { rowId, userSentence } = body;

  if (typeof rowId !== "number" || !Number.isFinite(rowId) || rowId <= 0) {
    return NextResponse.json({ error: "rowId required" }, { status: 400 });
  }
  if (typeof userSentence !== "string") {
    return NextResponse.json({ error: "userSentence required" }, { status: 400 });
  }

  const row = getDb()
    .prepare(
      `SELECT id, target_word_original, english_description
       FROM user_vocab WHERE id = ? AND user_id = ?`,
    )
    .get(rowId, session.userId) as
    | { id: number; target_word_original: string; english_description: string }
    | undefined;
  if (!row) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  try {
    const verdict = await judgeVocabSentence({
      target_word: row.target_word_original,
      tested_description: row.english_description,
      user_sentence: userSentence.trim(),
      target_language: DEFAULT_TARGET.language,
      native_language: user.nativeLanguage,
    });
    return NextResponse.json({
      result: verdict,
      english_description: row.english_description,
    });
  } catch (err) {
    console.error("[/api/vocab/judge-sentence]", err);
    return NextResponse.json({ error: "Judge failed" }, { status: 500 });
  }
}
