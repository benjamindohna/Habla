import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { translateWordInContext } from "@/lib/aiBubblePipeline";

/**
 * Playground Call B (on-tap): translate a single word in the context of
 * its sentence. The LLM also decides whether the tapped word belongs to
 * a multi-word unit (article+noun, compound tense, idiom, named entity)
 * and returns the full segment alongside the translation.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const user = getUserById(session.userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    sentence?: unknown;
    word?: unknown;
    wordIndex?: unknown;
  };
  const sentence = typeof body.sentence === "string" ? body.sentence.trim() : "";
  const word = typeof body.word === "string" ? body.word.trim() : "";
  const wordIndex = typeof body.wordIndex === "number" ? body.wordIndex : -1;
  if (!sentence || !word || wordIndex < 0) {
    return NextResponse.json({ error: "sentence, word, wordIndex required" }, { status: 400 });
  }

  try {
    const result = await translateWordInContext({
      sentence,
      word,
      wordIndex,
      nativeLanguage: user.nativeLanguage,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/playground/translate]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
