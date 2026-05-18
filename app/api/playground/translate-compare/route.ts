import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { translateWordInContext } from "@/lib/aiBubblePipeline";

/**
 * A-B comparison: send the SAME translateWord prompt to both gpt-4o
 * (chat_precise) and gpt-4o-mini (chat_light), in parallel, return both
 * results plus per-call latency. Used by the on-tap playground to
 * eyeball model quality differences and decide whether mini is good
 * enough for production.
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

  const baseArgs = { sentence, word, wordIndex, nativeLanguage: user.nativeLanguage, targetLanguage: user.targetLanguage };

  try {
    const startPrecise = performance.now();
    const startLight = performance.now();
    const [precise, light] = await Promise.all([
      translateWordInContext({ ...baseArgs, task: "chat_precise" }).then((result) => ({
        ...result,
        ms: Math.round(performance.now() - startPrecise),
      })),
      translateWordInContext({ ...baseArgs, task: "chat_light" }).then((result) => ({
        ...result,
        ms: Math.round(performance.now() - startLight),
      })),
    ]);
    return NextResponse.json({ precise, light });
  } catch (err) {
    console.error("[/api/playground/translate-compare]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
