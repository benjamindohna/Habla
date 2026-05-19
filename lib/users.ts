import { db } from "./db";
import { users, userInterests } from "./schema";
import { eq, sql } from "drizzle-orm";
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

type UserRow = typeof users.$inferSelect;

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    nativeLanguage: row.nativeLanguage,
    targetLanguage: parseTargetLanguageSpec(row.targetLanguageJson),
    level: row.level,
    interestsText: row.interestsText,
    correctionStyle: row.correctionStyle === "transcript_aware" ? "transcript_aware" : "natural",
    createdAt: row.createdAt,
  };
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(users)
    .where(sql`LOWER(${users.email}) = LOWER(${email})`)
    .limit(1);
  return rows[0] ? rowToUser(rows[0]) : null;
}

export async function getUserById(id: number): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ? rowToUser(rows[0]) : null;
}

export async function upsertUser(input: {
  email: string;
  passwordHash: string;
  nativeLanguage?: string;
  targetLanguage?: TargetLanguageSpec;
  level?: number;
  interestsText?: string;
}): Promise<User> {
  const targetJson = JSON.stringify(input.targetLanguage ?? INITIAL_TARGET_SEED);
  await db
    .insert(users)
    .values({
      email: input.email,
      passwordHash: input.passwordHash,
      nativeLanguage: input.nativeLanguage ?? "German",
      targetLanguageJson: targetJson,
      level: input.level ?? 30,
      interestsText: input.interestsText ?? "",
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        passwordHash: input.passwordHash,
        nativeLanguage: input.nativeLanguage ?? "German",
        targetLanguageJson: targetJson,
        level: input.level ?? 30,
        interestsText: input.interestsText ?? "",
      },
    });
  const user = await getUserByEmail(input.email);
  if (!user) throw new Error(`Failed to upsert user ${input.email}`);
  return user;
}

export async function getUserInterests(userId: number): Promise<string[]> {
  const rows = await db
    .select({ interest: userInterests.interest })
    .from(userInterests)
    .where(eq(userInterests.userId, userId))
    .orderBy(userInterests.addedAt);
  return rows.map((r) => r.interest);
}

export async function setUserInterests(userId: number, interests: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(userInterests).where(eq(userInterests.userId, userId));
    if (interests.length === 0) return;
    await tx.insert(userInterests).values(interests.map((interest) => ({ userId, interest })));
  });
}

export async function addUserInterest(userId: number, interest: string): Promise<void> {
  await db
    .insert(userInterests)
    .values({ userId, interest })
    .onConflictDoNothing();
}

export async function setUserInterestsText(userId: number, text: string): Promise<void> {
  await db.update(users).set({ interestsText: text }).where(eq(users.id, userId));
}

export async function setUserCorrectionStyle(userId: number, style: CorrectionStyle): Promise<void> {
  await db.update(users).set({ correctionStyle: style }).where(eq(users.id, userId));
}
