import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";

type DbHandle = Database.Database;

const globalForDb = globalThis as unknown as { __hablaDb?: DbHandle };

function dbPath(): string {
  return process.env.DATABASE_PATH ?? join(process.cwd(), "data", "habla.db");
}

function initDb(): DbHandle {
  const path = dbPath();
  mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schema = readFileSync(join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);

  return db;
}

export function getDb(): DbHandle {
  if (!globalForDb.__hablaDb) {
    globalForDb.__hablaDb = initDb();
  }
  return globalForDb.__hablaDb;
}
