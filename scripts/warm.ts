import { getDb } from "../lib/db";
import { ensureUserTopicSets } from "../lib/topicSets";

async function main() {
  const arg = process.argv[2];
  let userIds: number[];

  if (arg) {
    // Specific user: argv may be an email or a numeric id.
    const isNumeric = /^\d+$/.test(arg);
    const row = isNumeric
      ? (getDb().prepare("SELECT id FROM users WHERE id = ?").get(Number(arg)) as { id: number } | undefined)
      : (getDb().prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?)").get(arg) as { id: number } | undefined);
    if (!row) {
      console.error(`No user matching "${arg}"`);
      process.exit(1);
    }
    userIds = [row.id];
  } else {
    // All users.
    const rows = getDb().prepare("SELECT id, email FROM users ORDER BY id").all() as { id: number; email: string }[];
    userIds = rows.map((r) => r.id);
  }

  console.log(`Warming topic sets for ${userIds.length} user(s)…`);
  for (const id of userIds) {
    const before = getDb()
      .prepare("SELECT email, current_set_id, next_set_id FROM users WHERE id = ?")
      .get(id) as { email: string; current_set_id: number | null; next_set_id: number | null };

    const needsCurrent = before.current_set_id == null;
    const needsNext = before.next_set_id == null;

    if (!needsCurrent && !needsNext) {
      console.log(`  ${before.email}  already warm`);
      continue;
    }

    const t0 = Date.now();
    await ensureUserTopicSets(id);
    const ms = Date.now() - t0;

    const after = getDb()
      .prepare("SELECT current_set_id, next_set_id FROM users WHERE id = ?")
      .get(id) as { current_set_id: number; next_set_id: number };

    console.log(
      `  ${before.email}  current=${after.current_set_id}  next=${after.next_set_id}  (${ms}ms)`,
    );
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
