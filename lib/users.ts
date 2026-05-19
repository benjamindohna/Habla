import { getDb } from "./db";
import {
  INITIAL_TARGET_SEED,
  parseTargetLanguageSpec,
  type TargetLanguageSpec,
} from "./targetLanguage";

export type CorrectionStyle = "natural" | "transcript_aware";

export interface User {
  id: number;
  email: string;
  passwordHash: string;
  nativeLanguage: string;
  /** The language this user is learning + region/style. Threaded into
   *  every prompt-creating function from the session. */
  targetLanguage: TargetLanguageSpec;
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
  target_language_json: string;
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
    targetLanguage: parseTargetLanguageSpec(row.target_language_json),
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
  targetLanguage?: TargetLanguageSpec;
  level?: number;
  interestsText?: string;
}): User {
  const db = getDb();
  const targetJson = JSON.stringify(input.targetLanguage ?? INITIAL_TARGET_SEED);
  db.prepare(
    `INSERT INTO users (email, password_hash, native_language, target_language_json, level, interests_text)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       password_hash         = excluded.password_hash,
       native_language       = excluded.native_language,
       target_language_json  = excluded.target_language_json,
       level                 = excluded.level,
       interests_text        = excluded.interests_text`,
  ).run(
    input.email,
    input.passwordHash,
    input.nativeLanguage ?? "German",
    targetJson,
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
