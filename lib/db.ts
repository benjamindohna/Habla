import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";

type DbHandle = Database.Database;

const globalForDb = globalThis as unknown as { __hablaDb?: DbHandle };

function dbPath(): string {
  return process.env.DATABASE_PATH ?? join(process.cwd(), "data", "habla.db");
}

function ensureColumn(db: DbHandle, table: string, column: string, defSql: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${defSql}`);
  }
}

function migrate(db: DbHandle): void {
  // SQLite has no ADD COLUMN IF NOT EXISTS — apply additive migrations explicitly.
  ensureColumn(db, "conversations", "ended_at", "INTEGER");
  ensureColumn(db, "user_interests", "is_recent", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "users", "current_set_id", "INTEGER REFERENCES topic_sets(id)");
  ensureColumn(db, "users", "next_set_id", "INTEGER REFERENCES topic_sets(id)");
  ensureColumn(db, "users", "correction_style", "TEXT NOT NULL DEFAULT 'natural'");
  ensureColumn(db, "user_unknown_words", "native_translation", "TEXT");
}

function initDb(): DbHandle {
  const path = dbPath();
  mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schema = readFileSync(join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
  migrate(db);

  return db;
}

export function getDb(): DbHandle {
  if (!globalForDb.__hablaDb) {
    globalForDb.__hablaDb = initDb();
  }
  return globalForDb.__hablaDb;
}
