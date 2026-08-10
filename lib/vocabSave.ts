// Save orchestrator for vocab entries. The single entry point that the
// AIBubble (production) and the playground save-test both call.
//
// Flow:
//   1. Normalise the segment → target_word_lower
//   2. Classify the segment's word class (LLM call, chat_light)
//   3. Look up existing rows for this user with same (target_word_lower,
//      word_class) — if one exists, this is the same lexical entry.
//        - hit  → soft-lapse the matched row, return "merged"
//        - miss → INSERT new row
//   4. Async: generate explanation + TTS in the background.
//
// What's different from the v1 pipeline (kept here for posterity since
// the architecture shift is large):
//   - english_description was the old per-sense anchor. It was dropped
//     because it conflated "lexical entry identity" (what we needed for
//     dedup) with "specific tested sense" (what the judge used) and made
//     the explain prompt do weird gymnastics. word_class is the new
//     identity anchor.
//   - The 2nd LLM call (compareVocabDescriptions / polysemy detector)
//     is gone. If "vino" was tapped twice as a noun, both taps merge
//     into one row — no fragile sense-comparison needed. If "vino" was
//     tapped once as a noun and once as a verb, two rows: word_class
//     differs, dedup misses, INSERT.
//
// Cost per save:
//   typical: 1 LLM call (classify, chat_light) ≈ $0.00005
//   plus async: explain (chat_precise) + tts; both cached, paid once
//   per (target_word, word_class) the user ever encounters.

import { db } from "./db";
import { userVocab } from "./schema";
import { and, eq, sql } from "drizzle-orm";
import { normalizeVocab } from "./vocab";
import { classifyVocab, type WordClass } from "./vocabClassify";
import { rerankAfterInsert } from "./vocabRanking";
import type { TargetLanguageSpec } from "./targetLanguage";
import { generateExplanation } from "./vocabExplain";
import { runInBackground } from "./background";
import { generateTts } from "./vocabTts";

export interface SaveVocabArgs {
  userId: number;
  /** The target-language segment as encountered (original casing,
   *  multi-word if the on-tap LLM grouped it; single word otherwise). */
  segment: string;
  /** The AI message the segment was tapped in. Used as context for
   *  word-class classification (the only remaining use of context in
   *  the save flow) and stored on the row for audit. */
  context_sentence: string;
  /** Optional 0-based word index of the originally-tapped word in
   *  context_sentence. Reserved for future use (not currently consumed
   *  by the classifier — kept on the args for API stability). */
  tapped_word_index?: number;
  /** User's native language (for downstream explain calls). */
  native_language: string;
  /** User's target language spec. Threaded into classifier + explain
   *  prompts. */
  targetLanguage: TargetLanguageSpec;
}

export type SaveVocabResult =
  | { action: "inserted"; rowId: number; wordClass: WordClass }
  | { action: "merged"; matchedRowId: number; wordClass: WordClass };

const SOFT_LAPSE_COOLDOWN_SECONDS = 5 * 60; // 5 minutes

export async function saveVocabEntry(args: SaveVocabArgs): Promise<SaveVocabResult> {
  const original = normalizeVocab(args.segment, true); // preserve casing
  const lower = original.toLowerCase();
  if (!original || !lower) {
    throw new Error("saveVocabEntry: empty segment after normalisation");
  }

  // Step 1: classify word class. The (word_lower, word_class) pair is
  // the dedup key — two captures of the same surface form in the same
  // word class are treated as the same lexical entry.
  const wordClass = await classifyVocab({
    target_word: original,
    context_sentence: args.context_sentence,
    targetLanguage: args.targetLanguage,
  });

  // Step 2: look up existing row for this user with same (lower, class).
  const existing = await db
    .select({
      id: userVocab.id,
      wordClass: userVocab.wordClass,
      stage: userVocab.stage,
      lastSeen: userVocab.lastSeen,
    })
    .from(userVocab)
    .where(
      and(
        eq(userVocab.userId, args.userId),
        eq(userVocab.targetWordLower, lower),
        eq(userVocab.wordClass, wordClass),
      ),
    )
    .orderBy(userVocab.id)
    .limit(1);

  if (existing.length > 0) {
    // Same lexical entry already exists — soft-lapse the matched row
    // (the user re-looked it up, so retention is imperfect).
    const matched = existing[0];
    await softLapseIfDue(args.userId, matched.id);
    return {
      action: "merged",
      matchedRowId: matched.id,
      wordClass,
    };
  }

  // No existing row → insert.
  const [inserted] = await db
    .insert(userVocab)
    .values({
      userId: args.userId,
      targetWordOriginal: original,
      targetWordLower: lower,
      wordClass,
      contextSentence: args.context_sentence,
    })
    .returning({ id: userVocab.id });
  const rowId = inserted.id;
  await rerankAfterInsert(args.userId, rowId);
  generateAssetsAsync(rowId, args.userId, original, wordClass, args.targetLanguage, args.native_language);
  return { action: "inserted", rowId, wordClass };
}

/**
 * Fire-and-forget async asset pre-generation. Runs the explain + TTS
 * calls in parallel right after a new row is inserted. The save
 * endpoint returns immediately; assets fill in shortly after. Failures
 * are logged but never propagated — the row exists either way, and
 * the explain/tts endpoints regenerate missing assets on demand.
 * Registered via runInBackground so Vercel keeps the instance alive
 * until the assets land (plain `void` was killed at response freeze —
 * prod rows ended up without translation/TTS).
 */
function generateAssetsAsync(
  rowId: number,
  userId: number,
  targetWord: string,
  wordClass: WordClass,
  targetLanguage: TargetLanguageSpec,
  nativeLanguage: string,
): void {
  runInBackground(Promise.allSettled([
    generateExplanation({
      target_word: targetWord,
      word_class: wordClass,
      targetLanguage,
      native_language: nativeLanguage,
    }).then(async (res) => {
      await db
        .update(userVocab)
        .set({ nativeTranslation: res.translation })
        .where(and(eq(userVocab.id, rowId), eq(userVocab.userId, userId)));
    }),
    generateTts(targetWord, targetLanguage).then(async (buf) => {
      await db
        .update(userVocab)
        .set({ ttsAudio: buf })
        .where(and(eq(userVocab.id, rowId), eq(userVocab.userId, userId)));
    }),
  ]).then((results) => {
    for (const r of results) {
      if (r.status === "rejected") {
        console.warn("[vocab/assets] generation failed:", r.reason);
      }
    }
  }), "vocab/assets");
}

/**
 * Soft-lapse a row when the user re-looks-up the same lexical entry —
 * they needed the translation again, so retention is imperfect. Halves
 * BOTH SRS stages (recognition + sentence) — same penalty as a test
 * "0" verdict in either mode. The re-tap signals general weakness on
 * the word, not a mode-specific failure, so both modes pay.
 *
 * Cooldown of 5 minutes on the stage halving prevents over-punishing
 * rapid re-checks of the same conversation bubble.
 *
 * looked_up is incremented on EVERY tap, regardless of cooldown — the
 * counter is a faithful tap-count for analytics, not gated by SRS
 * scheduling. last_seen is also always updated.
 */
async function softLapseIfDue(userId: number, rowId: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - SOFT_LAPSE_COOLDOWN_SECONDS;
  await db
    .update(userVocab)
    .set({
      stage: sql`CASE WHEN ${userVocab.lastSeen} < ${cutoff} THEN GREATEST(0, ${userVocab.stage} / 2) ELSE ${userVocab.stage} END`,
      stageSentence: sql`CASE WHEN ${userVocab.lastSeen} < ${cutoff} THEN GREATEST(0, ${userVocab.stageSentence} / 2) ELSE ${userVocab.stageSentence} END`,
      lookedUp: sql`${userVocab.lookedUp} + 1`,
      lastSeen: now,
    })
    .where(and(eq(userVocab.id, rowId), eq(userVocab.userId, userId)));
}
