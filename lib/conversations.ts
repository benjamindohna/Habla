import { getDb } from "./db";
import { chatText } from "./llm";
import type { Pair } from "@/types/correction";
import type { Segment } from "@/types/segment";

export type MessageRole = "ai" | "user";

export interface ConversationRow {
  id: number;
  user_id: number;
  topic: string;
  created_at: number;
  ended_at: number | null;
}

export interface MessageRow {
  id: number;
  conversation_id: number;
  role: MessageRole;
  text_target: string;
  user_raw: string | null;
  segments_json: string | null;
  created_at: number;
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

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    role: row.role,
    textTarget: row.text_target,
    userRaw: row.user_raw,
    segments: row.segments_json ? JSON.parse(row.segments_json) : null,
    createdAt: row.created_at,
  };
}

export function createConversation(userId: number, topic: string): number {
  const result = getDb()
    .prepare("INSERT INTO conversations (user_id, topic) VALUES (?, ?)")
    .run(userId, topic);
  return Number(result.lastInsertRowid);
}

export function getConversation(id: number): ConversationRow | null {
  const row = getDb()
    .prepare("SELECT * FROM conversations WHERE id = ?")
    .get(id) as ConversationRow | undefined;
  return row ?? null;
}

export function getMessages(conversationId: number): Message[] {
  const rows = getDb()
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id")
    .all(conversationId) as MessageRow[];
  return rows.map(rowToMessage);
}

export function appendMessage(input: {
  conversationId: number;
  role: MessageRole;
  textTarget: string;
  userRaw?: string | null;
  segments?: Pair[] | Segment[] | null;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO messages (conversation_id, role, text_target, user_raw, segments_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.conversationId,
      input.role,
      input.textTarget,
      input.userRaw ?? null,
      input.segments ? JSON.stringify(input.segments) : null,
    );
  return Number(result.lastInsertRowid);
}

export function markConversationEnded(conversationId: number): void {
  getDb()
    .prepare("UPDATE conversations SET ended_at = strftime('%s','now') WHERE id = ? AND ended_at IS NULL")
    .run(conversationId);
}

export function updateConversationTopic(conversationId: number, topic: string): void {
  getDb()
    .prepare("UPDATE conversations SET topic = ? WHERE id = ?")
    .run(topic, conversationId);
}

/** Deletes a conversation IF it belongs to userId AND has zero messages.
 *  Returns true on delete, false otherwise. Used for empty-chat cleanup
 *  when the user navigates away without interacting. */
export function deleteConversationIfEmpty(userId: number, conversationId: number): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT c.id
       FROM conversations c
       WHERE c.id = ? AND c.user_id = ?
         AND NOT EXISTS (SELECT 1 FROM messages WHERE conversation_id = c.id)`,
    )
    .get(conversationId, userId);
  if (!row) return false;
  db.prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
  return true;
}

export interface RecentConversation {
  id: number;
  topic: string;
  lastActivity: number;
  messageCount: number;
}

/** Recent non-empty conversations for the homepage list. Sorted by
 *  last activity (latest message timestamp), most recent first. */
export function getRecentConversations(userId: number, limit: number): RecentConversation[] {
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.topic,
              COALESCE(MAX(m.created_at), c.created_at) AS last_activity,
              COUNT(m.id) AS message_count
       FROM conversations c
       INNER JOIN messages m ON m.conversation_id = c.id
       WHERE c.user_id = ?
       GROUP BY c.id
       ORDER BY last_activity DESC
       LIMIT ?`,
    )
    .all(userId, limit) as Array<{
    id: number;
    topic: string;
    last_activity: number;
    message_count: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    lastActivity: r.last_activity,
    messageCount: r.message_count,
  }));
}

/** Derives a short, target-language conversation title from the first
 *  user message. Used when the user starts a chat by speaking instead
 *  of picking a topic — we want every conversation to have a label for
 *  the recent-chats list and analytics. Fires in parallel with the AI
 *  reply so it never adds turn latency.
 *
 *  Output is in the TARGET language so the homepage chat list matches
 *  the rest of the topic-naming convention ("¿Qué pasaría si...?",
 *  "El estilo de juego de Messi"). */
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
