# Deferred: DB-integration tests for lib/conversations

The conversations test (createConversation / deleteIfEmpty /
getRecentConversations / targetLanguage round-trip) was originally
written against an in-memory SQLite via better-sqlite3 `:memory:`. After
the migration to Postgres/Drizzle, the test was moved here while we
explored options.

## What was tried

`pg-mem` (in-process Postgres in JavaScript) + Drizzle's
`drizzle-orm/node-postgres` adapter. Hits a hard incompatibility:

```
NotSupported: 🔨 Not supported 🔨 : getTypeParser is not supported
  at MemPg.adaptQuery
```

pg-mem's pg-adapter doesn't implement the `getTypeParser` method that
modern node-postgres / Drizzle's prepared-statement path uses.
Monkey-patching is possible but the maintenance cost outweighs the
benefit for our test surface.

## Path forward (when motivated)

Three realistic routes if these tests become important:

1. **Neon test branch** — create a separate Neon DB branch, set
   `DATABASE_URL_TEST`, run migrations once, point the test there.
   Pros: real Postgres, exact production parity. Cons: ~50ms per
   query × 15 tests = ~1s suite slow-down; needs Neon side-config.

2. **Local Docker Postgres** — spin up a postgres:17 container in
   tests/setup.ts before-all, tear down after. Pros: real Postgres,
   fast (~5ms per query, in-memory tmpfs option). Cons: requires
   Docker on dev machine, adds CI complexity.

3. **Wrap pg-mem with a getTypeParser shim** — write a thin adapter
   that proxies pg-mem's Pool but adds the missing method. Possibly
   ~30 lines. Pros: in-process, fast. Cons: brittle; future Drizzle
   versions may pull more pg internals that pg-mem doesn't expose.

## Coverage gap acknowledged

The lib functions covered by the deferred test:

- `createConversation` / `getConversation`
- `updateConversationTopic`
- `deleteConversationIfEmpty` (empty/non-empty/cross-user/non-existent)
- `getRecentConversations` (filter/order/limit/scope/count)
- `upsertUser` targetLanguage round-trip

These were exercised live by the Phase-5 deploy (Lavi login on Custom
Domain, vocab queue) and by manual seed-script runs against Neon. The
79 remaining test cases (pure logic: targetLanguage parsing, level
ranges, prompt examples, greeting verb rotation, vocab canonicalization)
all pass.
