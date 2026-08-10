import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { withRouteUsage } from "@/lib/usageContext";
import { getUserById } from "@/lib/users";
import { getReadingWords, generateReadingStory, type ReadingSort } from "@/lib/readingStory";
import { warmAnnotation } from "@/lib/annotate";

/**
 * Generates a reading-mode story from the user's vocab. Body:
 *   { sort?: "stale" | "recent" | "important" | "wrong" }
 * Returns { title, story, words } — `words` is the target list that
 * was fed to the model (shown nowhere in v1, but useful for debugging
 * and a future "which words did I meet" recap).
 *
 * The story's annotation cache is warmed before the response returns
 * visible text to the client renderer — taps resolve quickly.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  return withRouteUsage("/api/reading/generate", session?.userId ?? null, async () => {
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const user = await getUserById(session.userId);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const body = (await req.json().catch(() => ({}))) as { sort?: string };
    const sort: ReadingSort =
      body.sort === "recent" || body.sort === "important" || body.sort === "wrong"
        ? body.sort
        : "stale";

    try {
      const words = await getReadingWords(session.userId, sort, 25);
      if (words.length < 8) {
        return NextResponse.json(
          {
            error:
              sort === "wrong"
                ? "Du hast noch nicht genug oft-falsche Wörter für einen Text."
                : sort === "stale"
                ? "Du hast noch nicht genug gefestigte Wörter (Stage 3+) für einen Text. Übe erst ein paar im Trainer!"
                : "Du hast noch nicht genug gespeicherte Wörter für einen Text.",
          },
          { status: 409 },
        );
      }

      const t0 = Date.now();
      const { title, story } = await generateReadingStory({
        words: words.map((w) => w.word),
        level: user.level,
        targetLanguage: user.targetLanguage,
      });
      console.log(`[timing] reading/generate sort=${sort} words=${words.length} ms=${Date.now() - t0}`);

      // Warm the tap-lookup annotation for the story paragraphs.
      for (const paragraph of story.split(/\n\n+/)) {
        if (paragraph.trim()) {
          warmAnnotation({
            text: paragraph,
            nativeLanguage: user.nativeLanguage,
            targetLanguage: user.targetLanguage,
          });
        }
      }

      return NextResponse.json({ title, story, words: words.map((w) => w.word) });
    } catch (err) {
      console.error("[/api/reading/generate]", err);
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
