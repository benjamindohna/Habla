import Database from "better-sqlite3";
import { mkdirSync, readFileSync, readdirSync } from "fs";
import { dirname, join } from "path";

type DbHandle = Database.Database;

const globalForDb = globalThis as unknown as { __hablaDb?: DbHandle };

function dbPath(): string {
  return process.env.DATABASE_PATH ?? join(process.cwd(), "data", "habla.db");
}

function migrationsDir(): string {
  return join(process.cwd(), "lib", "migrations");
}

function listMigrationFiles(): string[] {
  return readdirSync(migrationsDir())
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function tableExists(db: DbHandle, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name) as { name: string } | undefined;
  return !!row;
}

/**
 * Applies any unapplied SQL files from lib/migrations/ in filename order,
 * tracked by `applied_migrations`. Each migration runs in its own transaction
 * so a failure rolls back cleanly.
 *
 * Bootstrap: the first time this runs against an existing DB that was built
 * by the legacy `schema.sql + ensureColumn` boot path, `applied_migrations`
 * is empty but `users` already exists. To avoid re-running the baseline
 * (which would fail on any non-idempotent statement that creeps into a
 * future migration), we mark every current migration as applied. From then
 * on, only genuinely new migrations execute.
 */
function runMigrations(db: DbHandle): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS applied_migrations (
       name       TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
     )`,
  );

  const all = listMigrationFiles();
  const applied = new Set(
    (db.prepare("SELECT name FROM applied_migrations").all() as { name: string }[]).map(
      (r) => r.name,
    ),
  );

  if (applied.size === 0 && tableExists(db, "users")) {
    const stmt = db.prepare("INSERT INTO applied_migrations (name) VALUES (?)");
    const tx = db.transaction(() => {
      for (const f of all) stmt.run(f);
    });
    tx();
    return;
  }

  const insert = db.prepare("INSERT INTO applied_migrations (name) VALUES (?)");
  for (const file of all) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir(), file), "utf-8");
    const tx = db.transaction(() => {
      db.exec(sql);
      insert.run(file);
    });
    tx();
  }
}

function initDb(): DbHandle {
  const path = dbPath();
  mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);

  return db;
}

export function getDb(): DbHandle {
  if (!globalForDb.__hablaDb) {
    globalForDb.__hablaDb = initDb();
  }
  return globalForDb.__hablaDb;
}
