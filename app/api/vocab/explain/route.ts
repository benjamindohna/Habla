import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { withRouteUsage } from "@/lib/usageContext";
import { getUserById } from "@/lib/users";
import { db } from "@/lib/db";
import { userVocab } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { generateExplanation } from "@/lib/vocabExplain";
import type { WordClass } from "@/lib/vocabClassify";

/**
 * Returns the row's native-language translation + hint. Cache-aware:
 * if the row already has both fields populated (pre-generated at insert
 * time or by the backfill script), they're returned directly with no
 * LLM call. Otherwise the prompt fires, and the result is written back
 * to the row before being returned — so the second call is always
 * cached.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  return withRouteUsage("/api/vocab/explain", session?.userId ?? null, async () => {
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
      wordClass: userVocab.wordClass,
      nativeTranslation: userVocab.nativeTranslation,
    })
    .from(userVocab)
    .where(and(eq(userVocab.id, rowId), eq(userVocab.userId, session.userId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  // Cache hit: native translation populated → return directly. Hint
  // field is gone after the explain-pipeline refactor; the response
  // shape keeps an empty hint string for frontend back-compat.
  if (row.nativeTranslation) {
    return NextResponse.json({
      translation: row.nativeTranslation,
      hint: "",
    });
  }

  // Cache miss: generate, persist, return. If word_class is missing
  // for a legacy row (pre-refactor), fall back to "noun" — the
  // classifier should have backfilled it via the migration script,
  // but never crash on a missing value.
  try {
    const result = await generateExplanation({
      target_word: row.targetWordOriginal,
      word_class: (row.wordClass ?? "noun") as WordClass,
      targetLanguage: user.targetLanguage,
      native_language: user.nativeLanguage,
    });
    await db
      .update(userVocab)
      .set({ nativeTranslation: result.translation })
      .where(and(eq(userVocab.id, row.id), eq(userVocab.userId, session.userId)));
    return NextResponse.json({ translation: result.translation, hint: "" });
  } catch (err) {
    console.error("[/api/vocab/explain]", err);
    return NextResponse.json({ error: "Explain failed" }, { status: 500 });
  }
  });
}
