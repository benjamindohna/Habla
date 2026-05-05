import { getDb } from "./db";
import type { Pair } from "@/types/correction";

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
  text_es: string;
  user_raw: string | null;
  segments_json: string | null;
  created_at: number;
}

export interface Message {
  id: number;
  role: MessageRole;
  textEs: string;
  userRaw: string | null;
  segments: Pair[] | null;
  createdAt: number;
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    role: row.role,
    textEs: row.text_es,
    userRaw: row.user_raw,
    segments: row.segments_json ? (JSON.parse(row.segments_json) as Pair[]) : null,
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
  textEs: string;
  userRaw?: string | null;
  segments?: Pair[] | null;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO messages (conversation_id, role, text_es, user_raw, segments_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.conversationId,
      input.role,
      input.textEs,
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
