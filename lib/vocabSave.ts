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

import { getDb } from "./db";
import { compareVocabDescriptions, generateVocabDescription, normalizeVocab } from "./vocab";
import { rerankAfterInsert } from "./vocabRanking";
import { DEFAULT_TARGET } from "./targetLanguage";

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
}

export type SaveVocabResult =
  | { action: "inserted"; rowId: number; description: string }
  | { action: "merged"; matchedRowId: number; matchedDescription: string }
  | { action: "polysemy_inserted"; rowId: number; description: string; siblingRowIds: number[] };

interface ExistingRow {
  id: number;
  english_description: string;
  stage: number;
}

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
    target_language: DEFAULT_TARGET.language,
    native_language: args.native_language,
  });

  const db = getDb();

  // Step 2: look up existing rows for this user with same target_word_lower.
  const existing = db
    .prepare(
      `SELECT id, english_description, stage, last_seen
       FROM user_vocab
       WHERE user_id = ? AND target_word_lower = ?
       ORDER BY id`,
    )
    .all(args.userId, lower) as Array<ExistingRow & { last_seen: number }>;

  if (existing.length === 0) {
    // No collision → straight insert.
    const result = db
      .prepare(
        `INSERT INTO user_vocab
           (user_id, target_word_original, target_word_lower, english_description, context_sentence)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(args.userId, original, lower, description, args.context_sentence);
    const rowId = Number(result.lastInsertRowid);
    await rerankAfterInsert(args.userId, rowId);
    return {
      action: "inserted",
      rowId,
      description,
    };
  }

  // Step 3: comparator decides synonym vs polysemy.
  const synonymIndex = await compareVocabDescriptions({
    target_word: original,
    new_description: description,
    existing_descriptions: existing.map((r) => r.english_description),
  });

  if (synonymIndex >= 0 && synonymIndex < existing.length) {
    // Synonym hit — discard the new entry, soft-lapse the matched row.
    // No rank change needed: the merged-into row keeps its rank.
    const matched = existing[synonymIndex];
    softLapseIfDue(args.userId, matched.id);
    return {
      action: "merged",
      matchedRowId: matched.id,
      matchedDescription: matched.english_description,
    };
  }

  // Different sense — insert as polyseme row.
  const result = db
    .prepare(
      `INSERT INTO user_vocab
         (user_id, target_word_original, target_word_lower, english_description, context_sentence)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(args.userId, original, lower, description, args.context_sentence);
  const rowId = Number(result.lastInsertRowid);
  await rerankAfterInsert(args.userId, rowId);
  return {
    action: "polysemy_inserted",
    rowId,
    description,
    siblingRowIds: existing.map((r) => r.id),
  };
}

/**
 * Soft-lapse a row when the user re-looks-up the same sense — they
 * needed the translation again, so retention is imperfect. Drop SRS
 * stage by 1 (down to a minimum of 0). Cooldown of 5 minutes prevents
 * over-punishing rapid re-checks of the same conversation bubble.
 */
function softLapseIfDue(userId: number, rowId: number): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - SOFT_LAPSE_COOLDOWN_SECONDS;
  db.prepare(
    `UPDATE user_vocab
     SET stage = MAX(0, stage - 1),
         lapses = lapses + 1,
         looked_up = looked_up + 1,
         last_seen = ?
     WHERE id = ? AND user_id = ? AND last_seen < ?`,
  ).run(now, rowId, userId, cutoff);

  // Always bump looked_up + last_seen even when the cooldown skips the
  // stage drop — we want to know the user touched the word again.
  db.prepare(
    `UPDATE user_vocab
     SET looked_up = CASE WHEN last_seen >= ? THEN looked_up + 1 ELSE looked_up END,
         last_seen = ?
     WHERE id = ? AND user_id = ?`,
  ).run(cutoff, now, rowId, userId);
}
