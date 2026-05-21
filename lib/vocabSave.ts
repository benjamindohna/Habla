// Save orchestrator for vocab entries. The single entry point that the
// AIBubble (production) and the playground save-test both call.
//
// Flow per ROADMAP.md "Vocabulary save & test":
//   1. Normalise the segment → target_word_lower
//   2. Generate English description (LLM call, gpt-4o-mini)
//   3. Look up existing rows for this user with same target_word_lower
//      - none      → INSERT new row
//      - 1 or more → comparator LLM decides synonym vs polysemy
//                    synonym  → discard new entry, soft-lapse the matched row
//                    polysemy → INSERT new row, separate SRS state
//
// Cost per save:
//   typical (no collision):   1 LLM call  (description gen),    ~$0.000054
//   on collision:             2 LLM calls (description + cmp),  ~$0.000104
//   most saves are typical → average is ~$0.00006

import { db } from "./db";
import { userVocab } from "./schema";
import { and, eq, sql } from "drizzle-orm";
import { compareVocabDescriptions, generateVocabDescription, normalizeVocab } from "./vocab";
import { rerankAfterInsert } from "./vocabRanking";
import type { TargetLanguageSpec } from "./targetLanguage";
import { generateExplanation } from "./vocabExplain";
import { generateTts } from "./vocabTts";

export interface SaveVocabArgs {
  userId: number;
  /** The target-language segment as encountered (original casing,
   *  multi-word if the on-tap LLM grouped it; single word otherwise). */
  segment: string;
  /** The AI message the segment was tapped in. Used as context for
   *  description generation and stored on the row for audit. */
  context_sentence: string;
  /** Optional 0-based word index of the originally-tapped word in
   *  context_sentence. When provided, the description-generator marks
   *  that occurrence with «…» to disambiguate repeated words. */
  tapped_word_index?: number;
  /** User's native language (for the description generator's framing
   *  prompt — the description itself is always English). */
  native_language: string;
  /** User's target language spec. Threaded into description / explain
   *  prompts so saves work the same for any target-language user. */
  targetLanguage: TargetLanguageSpec;
}

export type SaveVocabResult =
  | { action: "inserted"; rowId: number; description: string }
  | { action: "merged"; matchedRowId: number; matchedDescription: string }
  | { action: "polysemy_inserted"; rowId: number; description: string; siblingRowIds: number[] };

const SOFT_LAPSE_COOLDOWN_SECONDS = 5 * 60; // 5 minutes per ROADMAP

export async function saveVocabEntry(args: SaveVocabArgs): Promise<SaveVocabResult> {
  const original = normalizeVocab(args.segment, true); // preserve casing
  const lower = original.toLowerCase();
  if (!original || !lower) {
    throw new Error("saveVocabEntry: empty segment after normalisation");
  }

  // Step 1: generate the English sense-key description.
  const description = await generateVocabDescription({
    target_word: original,
    context_sentence: args.context_sentence,
    tapped_word_index: args.tapped_word_index,
    targetLanguage: args.targetLanguage,
    native_language: args.native_language,
  });

  // Step 2: look up existing rows for this user with same target_word_lower.
  const existing = await db
    .select({
      id: userVocab.id,
      englishDescription: userVocab.englishDescription,
      stage: userVocab.stage,
      lastSeen: userVocab.lastSeen,
    })
    .from(userVocab)
    .where(and(eq(userVocab.userId, args.userId), eq(userVocab.targetWordLower, lower)))
    .orderBy(userVocab.id);

  if (existing.length === 0) {
    // No collision → straight insert.
    const [inserted] = await db
      .insert(userVocab)
      .values({
        userId: args.userId,
        targetWordOriginal: original,
        targetWordLower: lower,
        englishDescription: description,
        contextSentence: args.context_sentence,
      })
      .returning({ id: userVocab.id });
    const rowId = inserted.id;
    await rerankAfterInsert(args.userId, rowId);
    generateAssetsAsync(rowId, args.userId, original, description, args.context_sentence, args.native_language, args.targetLanguage);
    return { action: "inserted", rowId, description };
  }

  // Step 3: comparator decides synonym vs polysemy.
  const synonymIndex = await compareVocabDescriptions({
    target_word: original,
    new_description: description,
    existing_descriptions: existing.map((r) => r.englishDescription),
  });

  if (synonymIndex >= 0 && synonymIndex < existing.length) {
    // Synonym hit — discard the new entry, soft-lapse the matched row.
    // No rank change needed: the merged-into row keeps its rank.
    const matched = existing[synonymIndex];
    await softLapseIfDue(args.userId, matched.id);
    return {
      action: "merged",
      matchedRowId: matched.id,
      matchedDescription: matched.englishDescription,
    };
  }

  // Different sense — insert as polyseme row.
  const [inserted] = await db
    .insert(userVocab)
    .values({
      userId: args.userId,
      targetWordOriginal: original,
      targetWordLower: lower,
      englishDescription: description,
      contextSentence: args.context_sentence,
    })
    .returning({ id: userVocab.id });
  const rowId = inserted.id;
  await rerankAfterInsert(args.userId, rowId);
  generateAssetsAsync(rowId, args.userId, original, description, args.context_sentence, args.native_language, args.targetLanguage);
  return {
    action: "polysemy_inserted",
    rowId,
    description,
    siblingRowIds: existing.map((r) => r.id),
  };
}

/**
 * Fire-and-forget async asset pre-generation. Runs the explain + TTS
 * calls in parallel right after a new row is inserted. The save
 * endpoint returns immediately; assets fill in shortly after. Failures
 * are logged but never propagated — the row exists either way, and
 * the explain/tts endpoints regenerate missing assets on demand.
 *
 * Called only on truly-new inserts (not on synonym merges, where the
 * matched row already has assets — or will be backfilled).
 */
function generateAssetsAsync(
  rowId: number,
  userId: number,
  targetWord: string,
  englishDescription: string,
  contextSentence: string,
  nativeLanguage: string,
  targetLanguage: TargetLanguageSpec,
): void {
  void Promise.allSettled([
    generateExplanation({
      target_word: targetWord,
      english_description: englishDescription,
      context_sentence: contextSentence,
      targetLanguage,
      native_language: nativeLanguage,
    }).then(async (res) => {
      await db
        .update(userVocab)
        .set({ nativeTranslation: res.translation, nativeHint: res.hint })
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
  });
}

/**
 * Soft-lapse a row when the user re-looks-up the same sense — they
 * needed the translation again, so retention is imperfect. Halves
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
