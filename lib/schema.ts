// Drizzle ORM schemas. Mirror of the SQLite schema after all 10
// migrations, ported to Postgres. Definitive source of truth for the
// table shape — drizzle-kit reads this to generate migration SQL and
// the runtime uses it for type-safe queries.
//
// Conventions kept identical to the SQLite-era code:
//   - timestamps are unix seconds (integer), not Postgres TIMESTAMP,
//     because the existing app logic compares against Date.now()/1000.
//   - JSON-shaped strings (recent_inputs_json, target_language_json,
//     topics_json, segments_json) stay TEXT; the app parses/serialises
//     itself. Could be upgraded to jsonb later if we want server-side
//     queries against those fields.
//   - tts_audio is bytea (binary). Cached MP3 blobs.

import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  customType,
  primaryKey,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Postgres bytea — no first-class Drizzle helper today, so define one.
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

// Default-now-in-seconds helper. Postgres `EXTRACT(EPOCH FROM NOW())`
// returns a numeric; cast to integer to match SQLite's integer-seconds
// convention.
const nowSeconds = sql`EXTRACT(EPOCH FROM NOW())::INTEGER`;

// ── users ────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  nativeLanguage: text("native_language").notNull().default("German"),
  level: integer("level").notNull().default(30),
  interestsText: text("interests_text").notNull().default(""),
  correctionStyle: text("correction_style").notNull().default("natural"),
  // FK targets defined below — Drizzle accepts the forward reference.
  currentSetId: integer("current_set_id").references((): AnyPgColumn => topicSets.id),
  nextSetId: integer("next_set_id").references((): AnyPgColumn => topicSets.id),
  recentInputsJson: text("recent_inputs_json").notNull().default("[]"),
  lastLevelCheckAt: integer("last_level_check_at"),
  targetLanguageJson: text("target_language_json")
    .notNull()
    .default('{"language":"Spanish","location":"castellano","style":"everyday"}'),
  samplesSinceLastCheck: integer("samples_since_last_check").notNull().default(0),
  createdAt: integer("created_at").notNull().default(nowSeconds),
});

// ── user_interests ───────────────────────────────────────────────────────

export const userInterests = pgTable(
  "user_interests",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    interest: text("interest").notNull(),
    addedAt: integer("added_at").notNull().default(nowSeconds),
    isRecent: integer("is_recent").notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.interest] }),
  }),
);

// ── conversations ────────────────────────────────────────────────────────

export const conversations = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    createdAt: integer("created_at").notNull().default(nowSeconds),
    endedAt: integer("ended_at"),
  },
  (t) => ({
    userIdIdx: index("idx_conversations_user_id").on(t.userId, t.id),
  }),
);

// ── messages ─────────────────────────────────────────────────────────────

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // 'ai' | 'user' — CHECK in raw migration
    textTarget: text("text_target").notNull(),
    userRaw: text("user_raw"),
    segmentsJson: text("segments_json"),
    createdAt: integer("created_at").notNull().default(nowSeconds),
  },
  (t) => ({
    convIdx: index("idx_messages_conv_id").on(t.conversationId, t.id),
  }),
);

// ── topic_sets ───────────────────────────────────────────────────────────

export const topicSets = pgTable(
  "topic_sets",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topicsJson: text("topics_json").notNull(),
    generatedAt: integer("generated_at").notNull().default(nowSeconds),
  },
  (t) => ({
    userIdIdx: index("idx_topic_sets_user_id").on(t.userId, t.id),
  }),
);

// ── user_vocab ───────────────────────────────────────────────────────────

export const userVocab = pgTable(
  "user_vocab",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetWordOriginal: text("target_word_original").notNull(),
    targetWordLower: text("target_word_lower").notNull(),
    // english_description was the old per-sense anchor. Now superseded
    // by word_class — the dedup + classification key is much simpler.
    // Column is kept nullable for legacy rows; new inserts leave it null.
    // Will be dropped in a follow-up cleanup migration once stable.
    englishDescription: text("english_description"),
    wordClass: text("word_class"),
    contextSentence: text("context_sentence"),
    stage: integer("stage").notNull().default(0),
    stageSentence: integer("stage_sentence").notNull().default(0),
    nextDueAt: integer("next_due_at"),
    correctStreak: integer("correct_streak").notNull().default(0),
    lookedUp: integer("looked_up").notNull().default(1),
    lastSeen: integer("last_seen").notNull().default(nowSeconds),
    relevanceRank: integer("relevance_rank").notNull().default(999999),
    nativeTranslation: text("native_translation"),
    nativeHint: text("native_hint"),
    ttsAudio: bytea("tts_audio"),
    createdAt: integer("created_at").notNull().default(nowSeconds),
  },
  (t) => ({
    userLowerIdx: index("idx_user_vocab_user_lower").on(t.userId, t.targetWordLower),
    // UNIQUE on the dedup key — the DB itself guarantees that two saves
    // of the same word in the same word class for the same user can
    // never produce duplicate rows, regardless of classifier drift or
    // race conditions in the save flow. Treated as a hard invariant.
    // NULL word_class (legacy rows pre-refactor) is allowed multiple
    // times because Postgres treats NULLs as distinct in UNIQUE — but
    // those rows will all get backfilled with non-null values, so the
    // long-term state has every row participating in uniqueness.
    userLowerClassUnique: uniqueIndex("ux_user_vocab_user_lower_class").on(
      t.userId,
      t.targetWordLower,
      t.wordClass,
    ),
    userDueIdx: index("idx_user_vocab_user_due").on(t.userId, t.nextDueAt),
    rankIdx: index("idx_user_vocab_rank").on(t.userId, t.relevanceRank),
  }),
);

// ── llm_usage ────────────────────────────────────────────────────────────
// One row per LLM/audio API call. Written fire-and-forget from logUsage /
// logAudioUsage in lib/llm.ts. user_id is nullable: scripts and pre-auth
// calls (e.g. login) have no user context, but they're still worth
// recording for total-spend accounting. Cost is computed at insert time
// from lib/llmPricing.ts using whatever counts the API returned.

export const llmUsage = pgTable(
  "llm_usage",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull().default(nowSeconds),
    label: text("label").notNull(),               // caller tag, e.g. "vocab/explain"
    model: text("model").notNull(),               // e.g. "gpt-4o-mini"
    kind: text("kind").notNull(),                 // 'chat' | 'transcription' | 'tts'
    promptTokens: integer("prompt_tokens"),       // chat only
    completionTokens: integer("completion_tokens"), // chat only
    reasoningTokens: integer("reasoning_tokens"), // chat only (xAI reasoning leak)
    inputChars: integer("input_chars"),           // tts (text length)
    inputBytes: integer("input_bytes"),           // transcription (audio bytes)
    outputBytes: integer("output_bytes"),         // tts (audio bytes)
    costUsd: text("cost_usd"),                    // stored as text to avoid float drift; "0.000123"
    route: text("route"),                         // HTTP route, when set via withUsageContext
  },
  (t) => ({
    userTimeIdx: index("idx_llm_usage_user_time").on(t.userId, t.createdAt),
    timeIdx: index("idx_llm_usage_time").on(t.createdAt),
  }),
);

// ── sentence_annotations ─────────────────────────────────────────────────
// Global (cross-user) cache for whole-sentence tap-lookup annotations.
// cache_key = sha256 over normalized text + native language + target
// language + prompt version + model (see lib/annotate.ts). Entries are
// valid forever for their key; bumping ANNOTATE_PROMPT_VERSION or the
// annotate model changes the key, so stale rows are simply never hit
// again (cheap logical invalidation, no cleanup required).

export const sentenceAnnotations = pgTable(
  "sentence_annotations",
  {
    id: serial("id").primaryKey(),
    cacheKey: text("cache_key").notNull(),
    text: text("text").notNull(),
    nativeLanguage: text("native_language").notNull(),
    targetLanguageJson: text("target_language_json").notNull(),
    promptVersion: integer("prompt_version").notNull(),
    model: text("model").notNull(),
    payload: text("payload").notNull(), // JSON SentenceAnnotation
    createdAt: integer("created_at").notNull().default(nowSeconds),
  },
  (t) => ({
    keyUnique: uniqueIndex("ux_sentence_annotations_key").on(t.cacheKey),
  }),
);

// ── inferred row + insert types ──────────────────────────────────────────
// Drizzle gives us $inferSelect / $inferInsert per table; the app uses
// those instead of hand-written interfaces.

export type UserRow = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type TopicSetRow = typeof topicSets.$inferSelect;
export type UserVocabRow = typeof userVocab.$inferSelect;
export type LlmUsageRow = typeof llmUsage.$inferSelect;
export type LlmUsageInsert = typeof llmUsage.$inferInsert;
