import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { db } from "@/lib/db";
import { userVocab } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { judgeVocabAnswer } from "@/lib/vocab";

/**
 * Run the LLM judge for a single attempt. Does NOT modify SRS state —
 * the client decides when to commit (via /api/vocab/commit) so users
 * can retry without cascading stage drops.
 *
 * Returns one of "1" | "X" | "0", plus the row's english_description
 * so the UI can reveal it after a give-up flow.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    rowId?: number;
    userAnswer?: string;
  };
  const { rowId, userAnswer } = body;

  if (typeof rowId !== "number" || !Number.isFinite(rowId) || rowId <= 0) {
    return NextResponse.json({ error: "rowId required" }, { status: 400 });
  }
  if (typeof userAnswer !== "string") {
    return NextResponse.json({ error: "userAnswer required" }, { status: 400 });
  }

  const rows = await db
    .select({
      id: userVocab.id,
      targetWordOriginal: userVocab.targetWordOriginal,
      englishDescription: userVocab.englishDescription,
    })
    .from(userVocab)
    .where(and(eq(userVocab.id, rowId), eq(userVocab.userId, session.userId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  try {
    const verdict = await judgeVocabAnswer({
      target_word: row.targetWordOriginal,
      tested_description: row.englishDescription,
      user_answer: userAnswer.trim(),
      targetLanguage: user.targetLanguage,
      native_language: user.nativeLanguage,
    });
    return NextResponse.json({
      result: verdict,
      english_description: row.englishDescription,
    });
  } catch (err) {
    console.error("[/api/vocab/judge]", err);
    return NextResponse.json({ error: "Judge failed" }, { status: 500 });
  }
}
