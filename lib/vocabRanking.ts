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

import { chatJSON } from "./llm";
import { db } from "./db";
import { userVocab } from "./schema";
import { and, eq, gte, ne, sql } from "drizzle-orm";
import { getUserById } from "./users";

const BULK_SORT_THRESHOLD = 15;

interface VocabRow {
  id: number;
  target_word_original: string;
  word_class: string | null;
  relevance_rank: number;
}

export async function rerankAfterInsert(userId: number, newRowId: number): Promise<void> {
  const user = await getUserById(userId);
  if (!user) return;
  const targetName = user.targetLanguage.language;
  const rowsRaw = await db
    .select({
      id: userVocab.id,
      target_word_original: userVocab.targetWordOriginal,
      word_class: userVocab.wordClass,
      relevance_rank: userVocab.relevanceRank,
    })
    .from(userVocab)
    .where(eq(userVocab.userId, userId))
    .orderBy(userVocab.relevanceRank, userVocab.id);
  const allRows = rowsRaw as VocabRow[];

  if (allRows.length === 0) return;

  if (allRows.length <= BULK_SORT_THRESHOLD) {
    await bulkSortAll(userId, allRows, targetName);
  } else {
    const newRow = allRows.find((r) => r.id === newRowId);
    if (!newRow) return;
    const others = allRows.filter((r) => r.id !== newRowId);
    const insertionRank = await binaryInsert(newRow, others, targetName);
    await applyBinaryInsert(userId, newRowId, insertionRank);
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
    console.warn("[vocab/bulkSort] LLM returned no matchable items, leaving ranks unchanged");
    return;
  } else if (missing.length === 0) {
    finalOrder = matched;
  } else {
    const middle = Math.floor(matched.length / 2);
    finalOrder = [...matched.slice(0, middle), ...missing, ...matched.slice(middle)];
  }

  await db.transaction(async (tx) => {
    for (let idx = 0; idx < finalOrder.length; idx++) {
      const row = finalOrder[idx];
      await tx
        .update(userVocab)
        .set({ relevanceRank: idx })
        .where(and(eq(userVocab.id, row.id), eq(userVocab.userId, userId)));
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Binary insert (3-anchor recursion)
// ─────────────────────────────────────────────────────────────────────────

type AnchorPosition = "before_A" | "between_AB" | "between_BC" | "after_C";

async function binaryInsert(newRow: VocabRow, sorted: VocabRow[], targetName: string): Promise<number> {
  let lo = 0;
  let hi = sorted.length;

  while (hi - lo > 3) {
    const range = hi - lo;
    const aIdx = lo + Math.floor(range / 4);
    const bIdx = lo + Math.floor(range / 2);
    const cIdx = lo + Math.floor((range * 3) / 4);
    if (aIdx >= bIdx || bIdx >= cIdx) break;
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
    if (pos === "before_A" || pos === "between_AB" || pos === "between_BC" || pos === "after_C") {
      return pos;
    }
  } catch (err) {
    console.warn("[vocab/binaryInsert] LLM call failed, defaulting to between_BC:", err);
  }
  return "between_BC";
}

async function applyBinaryInsert(userId: number, newRowId: number, insertionRank: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(userVocab)
      .set({ relevanceRank: sql`${userVocab.relevanceRank} + 1` })
      .where(
        and(
          eq(userVocab.userId, userId),
          gte(userVocab.relevanceRank, insertionRank),
          ne(userVocab.id, newRowId),
        ),
      );
    await tx
      .update(userVocab)
      .set({ relevanceRank: insertionRank })
      .where(and(eq(userVocab.id, newRowId), eq(userVocab.userId, userId)));
  });
}

function formatItem(row: VocabRow): string {
  // Ranking LLM only needs the surface form + a coarse word-class hint
  // so it can distinguish "vino" the noun from "vino" the verb when
  // both exist. The old english_description was richer but is gone
  // post-refactor; word_class is enough for linguistic-importance
  // ranking. Legacy rows with null word_class fall back to a bare word.
  const cls = row.word_class ? ` (${row.word_class})` : "";
  return `${row.target_word_original}${cls}`;
}
