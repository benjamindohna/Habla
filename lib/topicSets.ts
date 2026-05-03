import { getDb } from "./db";
import { generateTopicsForUser, type Topic } from "./generateTopics";

const ARCHIVE_KEEP = 4; // 4 previous sets retained per user

interface TopicSetRow {
  id: number;
  user_id: number;
  topics_json: string;
  generated_at: number;
}

interface UserPointersRow {
  current_set_id: number | null;
  next_set_id: number | null;
}

function getUserPointers(userId: number): UserPointersRow {
  const row = getDb()
    .prepare("SELECT current_set_id, next_set_id FROM users WHERE id = ?")
    .get(userId) as UserPointersRow | undefined;
  if (!row) throw new Error(`User ${userId} not found`);
  return row;
}

function readSet(setId: number): Topic[] | null {
  const row = getDb()
    .prepare("SELECT topics_json FROM topic_sets WHERE id = ?")
    .get(setId) as { topics_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.topics_json) as Topic[];
}

export function getCurrentSet(userId: number): Topic[] | null {
  const { current_set_id } = getUserPointers(userId);
  return current_set_id != null ? readSet(current_set_id) : null;
}

export function getNextSet(userId: number): Topic[] | null {
  const { next_set_id } = getUserPointers(userId);
  return next_set_id != null ? readSet(next_set_id) : null;
}

/**
 * All topic strings the user has seen across current + next + archived sets.
 * Used as the exclusion list when generating a new set so we don't repeat.
 */
export function getExclusionList(userId: number): string[] {
  const rows = getDb()
    .prepare("SELECT topics_json FROM topic_sets WHERE user_id = ?")
    .all(userId) as { topics_json: string }[];

  const seen = new Set<string>();
  for (const r of rows) {
    const topics = JSON.parse(r.topics_json) as Topic[];
    for (const t of topics) seen.add(t.es);
  }
  return Array.from(seen);
}

function insertSet(userId: number, topics: Topic[]): number {
  const result = getDb()
    .prepare("INSERT INTO topic_sets (user_id, topics_json) VALUES (?, ?)")
    .run(userId, JSON.stringify(topics));
  return Number(result.lastInsertRowid);
}

function setCurrentPointer(userId: number, setId: number | null): void {
  getDb().prepare("UPDATE users SET current_set_id = ? WHERE id = ?").run(setId, userId);
}

function setNextPointer(userId: number, setId: number | null): void {
  getDb().prepare("UPDATE users SET next_set_id = ? WHERE id = ?").run(setId, userId);
}

/**
 * Deletes archived sets older than the most recent ARCHIVE_KEEP. Current and
 * next pointers are excluded from the count and never deleted.
 */
function pruneArchives(userId: number): void {
  const { current_set_id, next_set_id } = getUserPointers(userId);
  const pinned = [current_set_id, next_set_id].filter((x): x is number => x != null);
  const placeholders = pinned.map(() => "?").join(",") || "NULL";

  const archived = getDb()
    .prepare(
      `SELECT id FROM topic_sets
       WHERE user_id = ? AND id NOT IN (${placeholders})
       ORDER BY id DESC`,
    )
    .all(userId, ...pinned) as { id: number }[];

  const toDelete = archived.slice(ARCHIVE_KEEP).map((r) => r.id);
  if (toDelete.length === 0) return;

  const del = getDb().prepare("DELETE FROM topic_sets WHERE id = ?");
  for (const id of toDelete) del.run(id);
}

/**
 * Generates a new set for the user and stores it as `next`. Idempotent at the
 * pointer level: caller decides when to invoke. Returns the new set's id.
 */
export async function generateAndStoreNext(userId: number): Promise<number> {
  const topics = await generateTopicsForUser(userId, getExclusionList(userId));
  const newSetId = insertSet(userId, topics);
  setNextPointer(userId, newSetId);
  return newSetId;
}

/**
 * Generates a set and stores it as `current`. Used by warm script when user
 * has no current yet.
 */
export async function generateAndStoreCurrent(userId: number): Promise<number> {
  const topics = await generateTopicsForUser(userId, getExclusionList(userId));
  const newSetId = insertSet(userId, topics);
  setCurrentPointer(userId, newSetId);
  return newSetId;
}

/**
 * Promotes `next` to `current`, clears the `next` pointer, and prunes
 * archives. Returns the new current's topics. Caller is responsible for
 * triggering background regeneration of `next`.
 *
 * If `next` is empty, returns null and does nothing — caller must handle the
 * synchronous fallback (rare).
 */
export function rotateNextToCurrent(userId: number): Topic[] | null {
  const db = getDb();
  const tx = db.transaction((): Topic[] | null => {
    const { next_set_id } = getUserPointers(userId);
    if (next_set_id == null) return null;
    const topics = readSet(next_set_id);
    if (!topics) return null;

    setCurrentPointer(userId, next_set_id);
    setNextPointer(userId, null);
    pruneArchives(userId);
    return topics;
  });
  return tx();
}

/**
 * Ensures the user has both a current and a next set. Generates whichever is
 * missing, in order (current first, then next so its exclusion list includes
 * current). Idempotent; safe to call repeatedly.
 */
export async function ensureUserTopicSets(userId: number): Promise<void> {
  const ptrs = getUserPointers(userId);
  if (ptrs.current_set_id == null) {
    await generateAndStoreCurrent(userId);
  }
  const ptrsAfter = getUserPointers(userId);
  if (ptrsAfter.next_set_id == null) {
    await generateAndStoreNext(userId);
  }
}

/**
 * Invalidates the preloaded `next` set. Used by Phase 7 when interests change
 * — the existing next was generated against stale interests, so we drop it
 * and let the background regenerate it. Safe to call when next is already null.
 */
export function invalidateNextSet(userId: number): void {
  const { next_set_id } = getUserPointers(userId);
  if (next_set_id == null) return;
  setNextPointer(userId, null);
  // The orphaned row will be cleaned up by the next pruneArchives() call.
}
