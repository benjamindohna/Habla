// Reading mode: pick a set of the user's vocab by a study angle and
// have an LLM weave them into a short, level-bounded story the user
// reads (and can listen to via TTS). Words the user taps go through
// the standard save flow — known words soft-lapse, new words get
// saved — exactly like in chat. v1 has no SRS effect for UN-tapped
// words: passive recognition is weaker evidence than trainer recall.

import { db } from "./db";
import { userVocab } from "./schema";
import { and, eq, sql } from "drizzle-orm";
import { chatJSON, benchModelAvailable, getBenchModel } from "./llm";
import { describeTargetLanguage, type TargetLanguageSpec } from "./targetLanguage";
import { getLevelRange } from "./levels";

/** Study angles for the reading word selection.
 *    stale     → known words (stage ≥ 3) longest not seen — the
 *                original concept: refresh the cold "known" stock.
 *    recent    → newest saves (mostly unknown; the story introduces
 *                them in context).
 *    important → personalised relevance ranking.
 *    wrong     → most-lapsed words in fresh contexts. */
export type ReadingSort = "stale" | "recent" | "important" | "wrong";

const KNOWN_STAGE_MIN = 3;

export interface ReadingWord {
  id: number;
  word: string;
}

export async function getReadingWords(
  userId: number,
  sort: ReadingSort,
  limit: number = 25,
): Promise<ReadingWord[]> {
  const base = { id: userVocab.id, word: userVocab.targetWordOriginal };
  const filter =
    sort === "stale"
      ? and(eq(userVocab.userId, userId), sql`${userVocab.stage} >= ${KNOWN_STAGE_MIN}`)
      : sort === "wrong"
      ? and(eq(userVocab.userId, userId), sql`${userVocab.wrongCount} > 0`)
      : eq(userVocab.userId, userId);
  const orderBy =
    sort === "stale"
      ? sql`${userVocab.lastSeen} ASC`
      : sort === "recent"
      ? sql`${userVocab.createdAt} DESC`
      : sort === "important"
      ? sql`${userVocab.relevanceRank} ASC`
      : sql`${userVocab.wrongCount} DESC, ${userVocab.lastSeen} ASC`;
  const rows = await db.select(base).from(userVocab).where(filter).orderBy(orderBy).limit(limit);
  return rows as ReadingWord[];
}

export interface ReadingStory {
  title: string;
  story: string;
}

/** Model choice: Claude Sonnet writes noticeably better constrained
 *  stories (validated empirically: 24/25 target words woven into a
 *  coherent A2 text). Reading is not latency-critical — the user
 *  expects a moment of "writing". Falls back to the production
 *  chat_precise model when no Anthropic key is configured. */
const STORY_BENCH_MODEL = "claude-sonnet-4-6";

export async function generateReadingStory(args: {
  words: string[];
  level: number;
  targetLanguage: TargetLanguageSpec;
}): Promise<ReadingStory> {
  const target = describeTargetLanguage(args.targetLanguage);
  const targetName = args.targetLanguage.language;
  const range = getLevelRange(args.level, args.targetLanguage);

  const prompt = `You are writing a short reading text for a ${targetName} learner.

Learner level: ${args.level}/100 (CEFR ${range.cefr}, "${range.short}"). ${range.description}

TARGET WORDS — you MUST naturally weave in as many of these as possible (they are words/phrases the learner has studied and should re-encounter). Use them in their given form or a lightly inflected form:
${args.words.map((w) => `- ${w}`).join("\n")}

HARD CONSTRAINTS:
- Every OTHER word in the story must be simple, high-frequency ${targetName} that a learner at this level almost certainly knows. Treat the learner's level as a CEILING for everything outside the target list — never reach for rarer vocabulary or harder grammar than the level allows.
- Variety: ${target}. Short sentences at low levels; relax sentence length as the level rises.
- 150-220 words total.
- The story must be coherent and genuinely engaging — a small narrative arc, not a word-salad. A touch of warmth or humor is welcome.

Return ONLY valid JSON:
{ "title": "<short title in ${targetName}>", "story": "<the story text, plain paragraphs separated by \\n\\n>" }`;

  const useSonnet =
    Boolean(getBenchModel(STORY_BENCH_MODEL)) &&
    benchModelAvailable(getBenchModel(STORY_BENCH_MODEL)!);

  const parsed = await chatJSON<{ title?: unknown; story?: unknown }>({
    task: "chat_precise",
    label: useSonnet ? `reading/story/${STORY_BENCH_MODEL}` : "reading/story",
    benchModel: useSonnet ? STORY_BENCH_MODEL : undefined,
    userPrompt: prompt,
    temperature: 0.7,
  });

  const title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : "Lectura";
  const story = typeof parsed.story === "string" ? parsed.story.trim() : "";
  if (!story) throw new Error("Model returned no story");
  return { title, story };
}
