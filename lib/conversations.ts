import { db } from "./db";
import { conversations, messages } from "./schema";
import { and, count, desc, eq, isNull, max, not, sql } from "drizzle-orm";
import { chatText } from "./llm";
import type { Pair } from "@/types/correction";
import type { Segment } from "@/types/segment";

export type MessageRole = "ai" | "user";

// Public-facing row shape uses snake_case to keep callers stable across
// the better-sqlite3 → Drizzle migration. Internally Drizzle uses
// camelCase but we convert on the way out.
export interface ConversationRow {
  id: number;
  user_id: number;
  topic: string;
  created_at: number;
  ended_at: number | null;
}

/**
 * Note: `segments_json` is overloaded by role.
 *  - role='user': the Pair[] alignment produced by /api/correct.
 *  - role='ai':   the Segment[] from /api/converse/* (tap-to-translate).
 * Same column, same JSON storage, different shape per role.
 */
export interface Message {
  id: number;
  role: MessageRole;
  textTarget: string;
  userRaw: string | null;
  segments: Pair[] | Segment[] | null;
  createdAt: number;
}

export async function createConversation(userId: number, topic: string): Promise<number> {
  const [row] = await db
    .insert(conversations)
    .values({ userId, topic })
    .returning({ id: conversations.id });
  return row.id;
}

export async function getConversation(id: number): Promise<ConversationRow | null> {
  const rows = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    user_id: r.userId,
    topic: r.topic,
    created_at: r.createdAt,
    ended_at: r.endedAt,
  };
}

export async function getMessages(conversationId: number): Promise<Message[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.id);
  return rows.map((r) => ({
    id: r.id,
    role: r.role as MessageRole,
    textTarget: r.textTarget,
    userRaw: r.userRaw,
    segments: r.segmentsJson ? (JSON.parse(r.segmentsJson) as Pair[] | Segment[]) : null,
    createdAt: r.createdAt,
  }));
}

export async function appendMessage(input: {
  conversationId: number;
  role: MessageRole;
  textTarget: string;
  userRaw?: string | null;
  segments?: Pair[] | Segment[] | null;
}): Promise<number> {
  const [row] = await db
    .insert(messages)
    .values({
      conversationId: input.conversationId,
      role: input.role,
      textTarget: input.textTarget,
      userRaw: input.userRaw ?? null,
      segmentsJson: input.segments ? JSON.stringify(input.segments) : null,
    })
    .returning({ id: messages.id });
  return row.id;
}

export async function markConversationEnded(conversationId: number): Promise<void> {
  await db
    .update(conversations)
    .set({ endedAt: sql`EXTRACT(EPOCH FROM NOW())::INTEGER` })
    .where(and(eq(conversations.id, conversationId), isNull(conversations.endedAt)));
}

export async function updateConversationTopic(conversationId: number, topic: string): Promise<void> {
  await db.update(conversations).set({ topic }).where(eq(conversations.id, conversationId));
}

/** Deletes a conversation IF it belongs to userId AND has zero messages.
 *  Returns true on delete, false otherwise. Used for empty-chat cleanup
 *  when the user navigates away without interacting. */
export async function deleteConversationIfEmpty(userId: number, conversationId: number): Promise<boolean> {
  // Two-step: check messages exist, then delete. Wrapped in transaction
  // so a concurrent message insert can't race past the check.
  return await db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
      .limit(1);
    if (owned.length === 0) return false;
    const hasMsg = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .limit(1);
    if (hasMsg.length > 0) return false;
    await tx.delete(conversations).where(eq(conversations.id, conversationId));
    return true;
  });
}

export interface RecentConversation {
  id: number;
  topic: string;
  lastActivity: number;
  messageCount: number;
}

/** Recent non-empty conversations for the homepage list. Sorted by
 *  last activity (latest message timestamp), most recent first. */
export async function getRecentConversations(userId: number, limit: number): Promise<RecentConversation[]> {
  const lastActivity = sql<number>`COALESCE(MAX(${messages.createdAt}), ${conversations.createdAt})`.as("last_activity");
  const messageCount = count(messages.id).as("message_count");
  const rows = await db
    .select({
      id: conversations.id,
      topic: conversations.topic,
      lastActivity,
      messageCount,
    })
    .from(conversations)
    .innerJoin(messages, eq(messages.conversationId, conversations.id))
    .where(eq(conversations.userId, userId))
    .groupBy(conversations.id)
    .orderBy(desc(lastActivity))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    lastActivity: Number(r.lastActivity),
    messageCount: Number(r.messageCount),
  }));
}

/** Derives a short, target-language conversation title from the first
 *  user message. Used when the user starts a chat by speaking instead
 *  of picking a topic. Fires in parallel with the AI reply so it never
 *  adds turn latency. Output is in the target language to match the
 *  rest of the topic-naming convention. */
export async function deriveConversationTopic(args: {
  firstUserMessage: string;
  targetLanguage: string;
  nativeLanguage: string;
}): Promise<string> {
  const prompt = `A language learner studying ${args.targetLanguage} has just spoken their first sentence in a new conversation. Generate a SHORT title (2–5 words, in ${args.targetLanguage}) that captures what they want to talk about. The title is used in a chat history list and must match the style of typical conversation topics in ${args.targetLanguage} (e.g. for Spanish: "El estilo de juego de Messi", "¿Qué pasaría si pudiéramos volar?", "Reflexiones sobre la vida en el mar").

Rules:
- 2 to 6 words. Natural ${args.targetLanguage} phrasing, including articles where appropriate. No trailing period.
- ${args.targetLanguage} only — do NOT use ${args.nativeLanguage}, even if the learner's message contained ${args.nativeLanguage} words (those are fallbacks for vocabulary they don't yet know).
- Capture the topic / subject, not the verbatim sentence. "Comí pizza ayer" → "La comida" or "Hábitos alimenticios", not "Pizza comida ayer".
- If the sentence is a greeting or chit-chat with no clear subject, fall back to "Charla libre" (in ${args.targetLanguage}; equivalent expression for other languages).

User's first message: "${args.firstUserMessage}"

Return ONLY the title string. No quotes, no explanation.`;
  const raw = await chatText({
    task: "chat_light",
    label: "converse/derive-topic",
    systemPrompt: prompt,
    temperature: 0.3,
    maxTokens: 30,
  });
  return raw.replace(/^["'\s]+|["'.\s]+$/g, "").trim();
}

// Suppress unused-import warnings from `max` and `not` (kept available
// for future filter additions).
void max;
void not;
