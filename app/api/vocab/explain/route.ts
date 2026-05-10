import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { getDb } from "@/lib/db";
import { chatJSON } from "@/lib/llm";
import { DEFAULT_TARGET } from "@/lib/targetLanguage";

/**
 * Generates a learner-facing answer for a vocab card the user has given
 * up on (via the "I don't know" button or after a wrong / three-strikes
 * outcome). Reads the row's English sense-key description, calls
 * gpt-4o-mini, and returns:
 *   - translation: the natural native-language translation for the
 *     tested sense (vocab-card style with article/gender as needed)
 *   - hint:        a short native-language example or memory aid
 *
 * No DB write — this is a pure read-and-explain. Stage update happens
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

  const targetName = DEFAULT_TARGET.language;
  const nativeLang = user.nativeLanguage;
  const prompt = `You are a vocabulary tutor. The learner is studying ${targetName}; their native language is ${nativeLang}.

The learner couldn't recall this word. Provide a clear answer plus a short memory aid.

Word: "${row.target_word_original}"
Sense being tested (in English): "${row.english_description}"

Return ONLY valid JSON:
{
  "translation": "<natural ${nativeLang} translation for the tested sense, vocab-card style — include article/gender for nouns, infinitive form for verbs, no quotes, no explanation>",
  "hint": "<short ${nativeLang} example sentence or memory aid that disambiguates THIS sense from other senses of the word, max 15 words, ends with a period>"
}`;

  try {
    const result = await chatJSON<{ translation?: string; hint?: string }>({
      task: "chat_light",
      label: "vocab/explain",
      systemPrompt: prompt,
      temperature: 0.3,
    });
    const translation = (result.translation ?? "").trim();
    const hint = (result.hint ?? "").trim();
    if (!translation) {
      return NextResponse.json({ error: "Empty explanation" }, { status: 500 });
    }
    return NextResponse.json({ translation, hint });
  } catch (err) {
    console.error("[/api/vocab/explain]", err);
    return NextResponse.json({ error: "Explain failed" }, { status: 500 });
  }
}
