import { getDb } from "./db";

export type CorrectionStyle = "natural" | "transcript_aware";

export interface User {
  id: number;
  email: string;
  passwordHash: string;
  nativeLanguage: string;
  level: number;
  interestsText: string;
  correctionStyle: CorrectionStyle;
  createdAt: number;
}

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  native_language: string;
  level: number;
  interests_text: string;
  correction_style: string;
  created_at: number;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    nativeLanguage: row.native_language,
    level: row.level,
    interestsText: row.interests_text,
    correctionStyle: (row.correction_style === "transcript_aware" ? "transcript_aware" : "natural"),
    createdAt: row.created_at,
  };
}

export function getUserByEmail(email: string): User | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?)")
    .get(email) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function getUserById(id: number): User | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function upsertUser(input: {
  email: string;
  passwordHash: string;
  nativeLanguage?: string;
  level?: number;
  interestsText?: string;
}): User {
  const db = getDb();
  db.prepare(
    `INSERT INTO users (email, password_hash, native_language, level, interests_text)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       password_hash   = excluded.password_hash,
       native_language = excluded.native_language,
       level           = excluded.level,
       interests_text  = excluded.interests_text`,
  ).run(
    input.email,
    input.passwordHash,
    input.nativeLanguage ?? "German",
    input.level ?? 30,
    input.interestsText ?? "",
  );
  const user = getUserByEmail(input.email);
  if (!user) throw new Error(`Failed to upsert user ${input.email}`);
  return user;
}

export function getUserInterests(userId: number): string[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT interest FROM user_interests WHERE user_id = ? ORDER BY added_at")
    .all(userId) as { interest: string }[];
  return rows.map((r) => r.interest);
}

export function setUserInterests(userId: number, interests: string[]): void {
  const db = getDb();
  const tx = db.transaction((items: string[]) => {
    db.prepare("DELETE FROM user_interests WHERE user_id = ?").run(userId);
    const stmt = db.prepare("INSERT INTO user_interests (user_id, interest) VALUES (?, ?)");
    for (const it of items) stmt.run(userId, it);
  });
  tx(interests);
}

export function addUserInterest(userId: number, interest: string): void {
  const db = getDb();
  db.prepare(
    "INSERT OR IGNORE INTO user_interests (user_id, interest) VALUES (?, ?)",
  ).run(userId, interest);
}

export function setUserInterestsText(userId: number, text: string): void {
  const db = getDb();
  db.prepare("UPDATE users SET interests_text = ? WHERE id = ?").run(text, userId);
}

export function setUserCorrectionStyle(userId: number, style: CorrectionStyle): void {
  const db = getDb();
  db.prepare("UPDATE users SET correction_style = ? WHERE id = ?").run(style, userId);
}

/**
 * Records a word/phrase the user looked up. Stores the surface form exactly
 * (lowercased, trimmed). On repeat lookups, increments looked_up and
 * refreshes last_seen — and fills native_translation if it was missing.
 */
export function recordLookedUpWord(
  userId: number,
  word: string,
  nativeTranslation: string | null,
): void {
  const normalized = word.trim().toLowerCase();
  if (!normalized) return;
  const db = getDb();
  db.prepare(
    `INSERT INTO user_unknown_words (user_id, word, native_translation, looked_up, last_seen)
     VALUES (?, ?, ?, 1, strftime('%s','now'))
     ON CONFLICT(user_id, word) DO UPDATE SET
       looked_up          = looked_up + 1,
       last_seen          = strftime('%s','now'),
       native_translation = COALESCE(user_unknown_words.native_translation, excluded.native_translation)`,
  ).run(userId, normalized, nativeTranslation?.trim() || null);
}
