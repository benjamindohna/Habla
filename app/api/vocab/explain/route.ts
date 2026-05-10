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

The learner couldn't recall this word. Give a clear, structurally-faithful answer plus a short memory aid.

The TRANSLATION must be the natural ${nativeLang} equivalent that mirrors the STRUCTURE of the target word — preserve every semantic component the target carries:
- Single noun → article (with correct gender) + noun.
- Single conjugated verb → infinitive form, OR include the subject pronoun if the conjugation is distinctive (1st/2nd person).
- Multi-word verbal phrase (compound tense, modal periphrasis, clitic + verb) → full ${nativeLang} equivalent that preserves tense, aspect, and any clitic objects. Do NOT collapse to a single word.
- Idiom / fixed expression → idiomatic ${nativeLang} equivalent (or close paraphrase if no exact idiom exists).
- Adjective / adverb / function word → plain natural form.

Worked examples (target Spanish, native German — illustrative, the same logic applies to any pair):
- "casa"                → translation: "das Haus", hint: "Ein Gebäude, in dem man wohnt."
- "comer"               → translation: "essen", hint: "Mahlzeiten zu sich nehmen."
- "comió"               → translation: "(er/sie) aß / hat gegessen", hint: "Vergangenheit von essen."
- "banco" (financial)   → translation: "die Bank (Geldinstitut)", hint: "Wo man Geld einzahlt oder abhebt."
- "banco" (bench)       → translation: "die Sitzbank", hint: "Eine lange Bank, auf der man im Park sitzt."
- "te haya impresionado" → translation: "(es) hat dich beeindruckt (Konjunktiv Perfekt)", hint: "Form nach „que" oder „ojalá", drückt Unsicherheit aus."
- "darse cuenta"        → translation: "merken / bemerken (reflexiv)", hint: "Etwas plötzlich verstehen oder feststellen."
- "echar de menos"      → translation: "vermissen", hint: "Jemanden oder etwas Abwesendes vermissen."
- "voy a hacer"         → translation: "ich werde machen / ich gehe machen (nahe Zukunft)", hint: "Ankündigung einer baldigen Handlung."

Word: "${row.target_word_original}"
Sense being tested (in English): "${row.english_description}"

If the Word and the Sense seem to disagree (e.g. the Sense omits a clitic that the Word clearly carries), trust the Word — describe what the Word actually says.

Return ONLY valid JSON:
{
  "translation": "<full ${nativeLang} translation that mirrors the target's structure>",
  "hint": "<short ${nativeLang} example or memory aid that disambiguates THIS sense from other senses of the word, max 15 words, ends with a period>"
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
