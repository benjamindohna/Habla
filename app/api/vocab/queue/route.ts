import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { withRouteUsage } from "@/lib/usageContext";
import { getUserById } from "@/lib/users";
import { getDueVocabQueue, type VocabMode, type VocabQueueSort } from "@/lib/vocabSrs";
import { generateExplanation } from "@/lib/vocabExplain";
import { runInBackground } from "@/lib/background";
import { db } from "@/lib/db";
import { userVocab } from "@/lib/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { WordClass } from "@/lib/vocabClassify";

/**
 * Returns the authenticated user's practice queue for a given mode.
 * Query params:
 *   - mode:    "recognition" (default) | "sentence"
 *   - limit:   1..100 (default 30)
 *   - sort:    "due" (default, mixed fresh+backlog) | "recent" |
 *              "important" | "wrong" — non-due sorts ignore dueness
 *              (free practice over the whole list).
 *   - exclude: comma-separated row ids already practiced this session,
 *              so "load next batch" skips them.
 *
 * Self-healing: rows still missing their pre-generated back side
 * (native_translation) get it generated in the background the moment
 * they enter a queue — i.e. while the user is still looking at the
 * FRONT of the deck, long before the first flip. Covers rows saved
 * before the waitUntil fix (assets used to die at response freeze) and
 * any future stragglers. isNull-guarded write, so a racing explain
 * call can't be overwritten.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  return withRouteUsage("/api/vocab/queue", session?.userId ?? null, async () => {
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const url = new URL(req.url);
    const limitParam = Number(url.searchParams.get("limit") ?? "30");
    const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : 30;
    const mode: VocabMode = url.searchParams.get("mode") === "sentence" ? "sentence" : "recognition";
    const sortParam = url.searchParams.get("sort");
    const sort: VocabQueueSort =
      sortParam === "recent" || sortParam === "important" || sortParam === "wrong"
        ? sortParam
        : "due";
    const excludeIds = (url.searchParams.get("exclude") ?? "")
      .split(",")
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 500);

    const cards = await getDueVocabQueue(session.userId, mode, limit, sort, excludeIds);

    const missing = cards.filter((c) => !c.native_translation);
    if (missing.length > 0) {
      const user = await getUserById(session.userId);
      if (user) {
        runInBackground(
          (async () => {
            for (const card of missing) {
              try {
                const res = await generateExplanation({
                  target_word: card.target_word_original,
                  word_class: ((card.word_class ?? "noun") as WordClass),
                  targetLanguage: user.targetLanguage,
                  native_language: user.nativeLanguage,
                });
                await db
                  .update(userVocab)
                  .set({ nativeTranslation: res.translation })
                  .where(
                    and(
                      eq(userVocab.id, card.id),
                      eq(userVocab.userId, user.id),
                      isNull(userVocab.nativeTranslation),
                    ),
                  );
              } catch (err) {
                console.warn(`[vocab/queue] backfill for row ${card.id} failed:`, (err as Error).message);
              }
            }
          })(),
          "vocab/queue-backfill",
        );
      }
    }

    return NextResponse.json({ cards });
  });
}
