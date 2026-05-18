// Personalised vocab relevance ranking. Two strategies depending on
// list size:
//   ≤ BULK_SORT_THRESHOLD rows: bulk-sort everything in one LLM call.
//                                Cheap and fully consistent.
//   >  threshold:                3-anchor binary insert for the new row.
//                                ~log4(N) LLM calls; existing ranks shift.
//
// Importance criterion: how fundamental and frequent the word/phrase is
// in the target language. The user's personal interests are intentionally
// NOT factored in — at this stage we don't have stable interest signal,
// and a pure linguistic-importance order is a good first approximation.
//
// Hallucination handling:
//   bulk-sort: items the LLM omitted are inserted in the middle of the
//              returned order; items the LLM hallucinated are ignored.
//   binary-insert: malformed output → fall back to "between_BC" so the
//              recursion converges toward the midpoint of the current
//              search range.
//
// Cost: gpt-4o-mini, ~$0.0003 per bulk-sort call (≤15 items),
// ~$0.0005 per save in binary-insert mode (~4 calls × $0.0001 each).

import { chatJSON } from "./llm";
import { getDb } from "./db";
import { getUserById } from "./users";

const BULK_SORT_THRESHOLD = 15;

interface VocabRow {
  id: number;
  target_word_original: string;
  english_description: string;
  relevance_rank: number;
}

/**
 * Re-rank the user's vocab list after a new row has been inserted.
 * Picks bulk-sort vs binary-insert automatically based on list size.
 */
export async function rerankAfterInsert(userId: number, newRowId: number): Promise<void> {
  const db = getDb();
  const user = getUserById(userId);
  if (!user) return;
  const targetName = user.targetLanguage.language;
  const allRows = db
    .prepare(
      `SELECT id, target_word_original, english_description, relevance_rank
       FROM user_vocab
       WHERE user_id = ?
       ORDER BY relevance_rank ASC, id ASC`,
    )
    .all(userId) as VocabRow[];

  if (allRows.length === 0) return;

  if (allRows.length <= BULK_SORT_THRESHOLD) {
    await bulkSortAll(userId, allRows, targetName);
  } else {
    const newRow = allRows.find((r) => r.id === newRowId);
    if (!newRow) return;
    const others = allRows.filter((r) => r.id !== newRowId);
    const insertionRank = await binaryInsert(newRow, others, targetName);
    applyBinaryInsert(userId, newRowId, insertionRank);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Bulk sort
// ─────────────────────────────────────────────────────────────────────────

async function bulkSortAll(userId: number, rows: VocabRow[], targetName: string): Promise<void> {
  const items = rows.map((r) => formatItem(r));
  const prompt = `You are sorting a learner's ${targetName} vocabulary list by importance for mastering ${targetName}.

Importance criterion: how fundamental and frequent the word (or phrase) is in everyday ${targetName}. Most important first (high-frequency core vocabulary that any ${targetName} learner needs early), least important last (rare, specialised, niche).

Do NOT weight by the learner's personal interests. Sort PURELY by linguistic importance for any ${targetName} learner.

Items to sort (each is "word — description"):
${items.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Output ONLY a JSON object with the same items in importance order, most important first:
{ "sorted": [ "<item>", "<item>", ... ] }

Rules:
- Use the EXACT strings from the input. Do not rephrase.
- Output every item exactly once. No additions, no omissions.
- The dash separator between word and description is an em-dash (—); preserve it.`;

  let llmResult: { sorted?: unknown };
  try {
    llmResult = await chatJSON<{ sorted?: unknown }>({
      task: "chat_light",
      label: "vocab/bulkSort",
      systemPrompt: prompt,
      temperature: 0.1,
    });
  } catch (err) {
    console.error("[vocab/bulkSort] LLM call failed, leaving ranks unchanged:", err);
    return;
  }

  const sortedItems: string[] = Array.isArray(llmResult.sorted)
    ? (llmResult.sorted.filter((s) => typeof s === "string") as string[])
    : [];

  // Match LLM-returned items back to rows by exact string. Hallucinated
  // extras are silently ignored. Items the LLM forgot get inserted at the
  // midpoint of the returned order so they're not arbitrarily ranked last.
  const itemToRow = new Map<string, VocabRow>();
  for (const r of rows) itemToRow.set(formatItem(r), r);

  const matched: VocabRow[] = [];
  const seen = new Set<number>();
  for (const item of sortedItems) {
    const row = itemToRow.get(item);
    if (row && !seen.has(row.id)) {
      matched.push(row);
      seen.add(row.id);
    }
  }
  const missing = rows.filter((r) => !seen.has(r.id));

  let finalOrder: VocabRow[];
  if (matched.length === 0) {
    // Total LLM failure — leave ranks unchanged.
    console.warn("[vocab/bulkSort] LLM returned no matchable items, leaving ranks unchanged");
    return;
  } else if (missing.length === 0) {
    finalOrder = matched;
  } else {
    // Splice missing rows into the middle of the matched ordering.
    const middle = Math.floor(matched.length / 2);
    finalOrder = [...matched.slice(0, middle), ...missing, ...matched.slice(middle)];
  }

  const db = getDb();
  const tx = db.transaction(() => {
    const upd = db.prepare("UPDATE user_vocab SET relevance_rank = ? WHERE id = ? AND user_id = ?");
    finalOrder.forEach((row, idx) => upd.run(idx, row.id, userId));
  });
  tx();
}

// ─────────────────────────────────────────────────────────────────────────
// Binary insert (3-anchor recursion)
// ─────────────────────────────────────────────────────────────────────────

type AnchorPosition = "before_A" | "between_AB" | "between_BC" | "after_C";

async function binaryInsert(newRow: VocabRow, sorted: VocabRow[], targetName: string): Promise<number> {
  // sorted is the existing list (without newRow), in importance order.
  // Returns the insertion position 0..sorted.length.
  let lo = 0;
  let hi = sorted.length;

  while (hi - lo > 3) {
    const range = hi - lo;
    const aIdx = lo + Math.floor(range / 4);
    const bIdx = lo + Math.floor(range / 2);
    const cIdx = lo + Math.floor((range * 3) / 4);
    if (aIdx >= bIdx || bIdx >= cIdx) break; // degenerate range
    const position = await compareToAnchors(newRow, sorted[aIdx], sorted[bIdx], sorted[cIdx], targetName);
    switch (position) {
      case "before_A":
        hi = aIdx;
        break;
      case "between_AB":
        lo = aIdx + 1;
        hi = bIdx;
        break;
      case "between_BC":
        lo = bIdx + 1;
        hi = cIdx;
        break;
      case "after_C":
        lo = cIdx + 1;
        break;
    }
  }
  // Final insertion: midpoint of the remaining range. Up to 3 positions
  // of imprecision, fine for a list of N>15.
  return lo + Math.floor((hi - lo) / 2);
}

async function compareToAnchors(
  newRow: VocabRow,
  a: VocabRow,
  b: VocabRow,
  c: VocabRow,
  targetName: string,
): Promise<AnchorPosition> {
  const prompt = `You are placing a new ${targetName} vocabulary item into an importance-sorted list.

Importance criterion: how fundamental and frequent the word (or phrase) is in everyday ${targetName}. Most important first.

Three anchor items, presented in importance order (A more important than B more important than C):
A: "${formatItem(a)}"
B: "${formatItem(b)}"
C: "${formatItem(c)}"

NEW item to place:
"${formatItem(newRow)}"

Where does the new item belong relative to the anchors?
- before_A     — more important than all three
- between_AB   — between A and B
- between_BC   — between B and C
- after_C      — less important than all three

Output ONLY valid JSON:
{ "position": "before_A" | "between_AB" | "between_BC" | "after_C" }`;

  try {
    const result = await chatJSON<{ position?: unknown }>({
      task: "chat_light",
      label: "vocab/binaryInsert",
      systemPrompt: prompt,
      temperature: 0,
    });
    const pos = result.position;
    if (
      pos === "before_A" ||
      pos === "between_AB" ||
      pos === "between_BC" ||
      pos === "after_C"
    ) {
      return pos;
    }
  } catch (err) {
    console.warn("[vocab/binaryInsert] LLM call failed, defaulting to between_BC:", err);
  }
  // Fallback: between_BC nudges the recursion toward the midpoint.
  return "between_BC";
}

function applyBinaryInsert(userId: number, newRowId: number, insertionRank: number): void {
  const db = getDb();
  const tx = db.transaction(() => {
    // Shift existing rows at or after the insertion rank up by 1.
    db.prepare(
      `UPDATE user_vocab
       SET relevance_rank = relevance_rank + 1
       WHERE user_id = ? AND relevance_rank >= ? AND id != ?`,
    ).run(userId, insertionRank, newRowId);
    // Place the new row at the chosen rank.
    db.prepare(
      `UPDATE user_vocab SET relevance_rank = ? WHERE id = ? AND user_id = ?`,
    ).run(insertionRank, newRowId, userId);
  });
  tx();
}

// ─────────────────────────────────────────────────────────────────────────

function formatItem(row: VocabRow): string {
  return `${row.target_word_original} — ${row.english_description}`;
}
