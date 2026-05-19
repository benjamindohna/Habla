import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { db } from "@/lib/db";
import { userVocab } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { judgeVocabSentence, explainSentenceMistake } from "@/lib/vocabSentenceJudge";

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

  const user = await getUserById(session.userId);
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

  const rows = await db
    .select({
      id: userVocab.id,
      targetWordOriginal: userVocab.targetWordOriginal,
      englishDescription: userVocab.englishDescription,
      nativeTranslation: userVocab.nativeTranslation,
    })
    .from(userVocab)
    .where(and(eq(userVocab.id, rowId), eq(userVocab.userId, session.userId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const trimmedSentence = userSentence.trim();

  try {
    const verdict = await judgeVocabSentence({
      target_word: row.targetWordOriginal,
      tested_description: row.englishDescription,
      user_sentence: trimmedSentence,
      targetLanguage: user.targetLanguage,
      native_language: user.nativeLanguage,
    });

    let mistakeHint: string | null = null;
    if (verdict === "0") {
      try {
        mistakeHint = await explainSentenceMistake({
          target_word: row.targetWordOriginal,
          tested_description: row.englishDescription,
          native_translation: row.nativeTranslation ?? "",
          user_sentence: trimmedSentence,
          targetLanguage: user.targetLanguage,
          native_language: user.nativeLanguage,
        });
      } catch (err) {
        console.error("[/api/vocab/judge-sentence] mistake-hint", err);
      }
    }

    return NextResponse.json({
      result: verdict,
      english_description: row.englishDescription,
      mistake_hint: mistakeHint,
    });
  } catch (err) {
    console.error("[/api/vocab/judge-sentence]", err);
    return NextResponse.json({ error: "Judge failed" }, { status: 500 });
  }
}
