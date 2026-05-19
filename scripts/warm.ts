import { db } from "../lib/db";
import { users } from "../lib/schema";
import { eq, sql } from "drizzle-orm";
import { ensureUserTopicSets } from "../lib/topicSets";

async function main() {
  const arg = process.argv[2];
  let userIds: number[];

  if (arg) {
    const isNumeric = /^\d+$/.test(arg);
    const rows = isNumeric
      ? await db.select({ id: users.id }).from(users).where(eq(users.id, Number(arg))).limit(1)
      : await db
          .select({ id: users.id })
          .from(users)
          .where(sql`LOWER(${users.email}) = LOWER(${arg})`)
          .limit(1);
    if (rows.length === 0) {
      console.error(`No user matching "${arg}"`);
      process.exit(1);
    }
    userIds = [rows[0].id];
  } else {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .orderBy(users.id);
    userIds = rows.map((r) => r.id);
  }

  console.log(`Warming topic sets for ${userIds.length} user(s)…`);
  for (const id of userIds) {
    const beforeRows = await db
      .select({
        email: users.email,
        current_set_id: users.currentSetId,
        next_set_id: users.nextSetId,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    const before = beforeRows[0];

    const needsCurrent = before.current_set_id == null;
    const needsNext = before.next_set_id == null;

    if (!needsCurrent && !needsNext) {
      console.log(`  ${before.email}  already warm`);
      continue;
    }

    const t0 = Date.now();
    await ensureUserTopicSets(id);
    const ms = Date.now() - t0;

    const afterRows = await db
      .select({ current_set_id: users.currentSetId, next_set_id: users.nextSetId })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    const after = afterRows[0];

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
