// drizzle-kit configuration — used for `drizzle-kit generate` (creates
// migration SQL files from schema.ts diffs) and `drizzle-kit migrate`
// (applies pending migrations to the DB).
//
// DATABASE_URL is read from .env.local; expected shape:
//   postgresql://user:pw@host/db?sslmode=require

import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL missing — set it in .env.local before running drizzle-kit");
}

export default defineConfig({
  schema: "./lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
