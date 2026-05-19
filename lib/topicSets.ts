import { db } from "./db";
import { users, topicSets } from "./schema";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { generateTopicsForUser, type Topic } from "./generateTopics";

const ARCHIVE_KEEP = 4; // 4 previous sets retained per user

interface UserPointers {
  current_set_id: number | null;
  next_set_id: number | null;
}

async function getUserPointers(userId: number): Promise<UserPointers> {
  const rows = await db
    .select({ current_set_id: users.currentSetId, next_set_id: users.nextSetId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (rows.length === 0) throw new Error(`User ${userId} not found`);
  return rows[0];
}

async function readSet(setId: number): Promise<Topic[] | null> {
  const rows = await db
    .select({ topics_json: topicSets.topicsJson })
    .from(topicSets)
    .where(eq(topicSets.id, setId))
    .limit(1);
  if (rows.length === 0) return null;
  return JSON.parse(rows[0].topics_json) as Topic[];
}

export async function getCurrentSet(userId: number): Promise<Topic[] | null> {
  const { current_set_id } = await getUserPointers(userId);
  return current_set_id != null ? readSet(current_set_id) : null;
}

export async function getNextSet(userId: number): Promise<Topic[] | null> {
  const { next_set_id } = await getUserPointers(userId);
  return next_set_id != null ? readSet(next_set_id) : null;
}

/**
 * All topic strings the user has seen across current + next + archived sets.
 * Used as the exclusion list when generating a new set so we don't repeat.
 */
export async function getExclusionList(userId: number): Promise<string[]> {
  const rows = await db
    .select({ topics_json: topicSets.topicsJson })
    .from(topicSets)
    .where(eq(topicSets.userId, userId));
  const seen = new Set<string>();
  for (const r of rows) {
    const topics = JSON.parse(r.topics_json) as Topic[];
    for (const t of topics) seen.add(t.target);
  }
  return Array.from(seen);
}

async function insertSet(userId: number, topics: Topic[]): Promise<number> {
  const [row] = await db
    .insert(topicSets)
    .values({ userId, topicsJson: JSON.stringify(topics) })
    .returning({ id: topicSets.id });
  return row.id;
}

async function setCurrentPointer(userId: number, setId: number | null): Promise<void> {
  await db.update(users).set({ currentSetId: setId }).where(eq(users.id, userId));
}

async function setNextPointer(userId: number, setId: number | null): Promise<void> {
  await db.update(users).set({ nextSetId: setId }).where(eq(users.id, userId));
}

/**
 * Deletes archived sets older than the most recent ARCHIVE_KEEP. Current and
 * next pointers are excluded from the count and never deleted.
 */
async function pruneArchives(userId: number): Promise<void> {
  const { current_set_id, next_set_id } = await getUserPointers(userId);
  const pinned = [current_set_id, next_set_id].filter((x): x is number => x != null);

  const archived =
    pinned.length === 0
      ? await db
          .select({ id: topicSets.id })
          .from(topicSets)
          .where(eq(topicSets.userId, userId))
          .orderBy(desc(topicSets.id))
      : await db
          .select({ id: topicSets.id })
          .from(topicSets)
          .where(and(eq(topicSets.userId, userId), notInArray(topicSets.id, pinned)))
          .orderBy(desc(topicSets.id));

  const toDelete = archived.slice(ARCHIVE_KEEP).map((r) => r.id);
  if (toDelete.length === 0) return;
  await db.delete(topicSets).where(inArray(topicSets.id, toDelete));
}

export async function generateAndStoreNext(userId: number): Promise<number> {
  const topics = await generateTopicsForUser(userId, await getExclusionList(userId));
  const newSetId = await insertSet(userId, topics);
  await setNextPointer(userId, newSetId);
  return newSetId;
}

export async function generateAndStoreCurrent(userId: number): Promise<number> {
  const topics = await generateTopicsForUser(userId, await getExclusionList(userId));
  const newSetId = await insertSet(userId, topics);
  await setCurrentPointer(userId, newSetId);
  return newSetId;
}

export async function rotateNextToCurrent(userId: number): Promise<Topic[] | null> {
  return await db.transaction(async (tx) => {
    const ptrs = await tx
      .select({ next_set_id: users.nextSetId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const nextId = ptrs[0]?.next_set_id ?? null;
    if (nextId == null) return null;
    const setRows = await tx
      .select({ topics_json: topicSets.topicsJson })
      .from(topicSets)
      .where(eq(topicSets.id, nextId))
      .limit(1);
    if (setRows.length === 0) return null;
    const topics = JSON.parse(setRows[0].topics_json) as Topic[];
    await tx.update(users).set({ currentSetId: nextId, nextSetId: null }).where(eq(users.id, userId));
    return topics;
  }).then(async (topics) => {
    if (topics) await pruneArchives(userId);
    return topics;
  });
}

export async function ensureUserTopicSets(userId: number): Promise<void> {
  const ptrs = await getUserPointers(userId);
  if (ptrs.current_set_id == null) {
    await generateAndStoreCurrent(userId);
  }
  const ptrsAfter = await getUserPointers(userId);
  if (ptrsAfter.next_set_id == null) {
    await generateAndStoreNext(userId);
  }
}

export async function invalidateNextSet(userId: number): Promise<void> {
  const { next_set_id } = await getUserPointers(userId);
  if (next_set_id == null) return;
  await setNextPointer(userId, null);
  // The orphaned row will be cleaned up by the next pruneArchives() call.
}
