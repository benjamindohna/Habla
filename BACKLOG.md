# Backlog

Things to do later — out of scope for the current phase but tracked so they don't get lost. Items here should reference the phase or feature that triggered them.

---

## Signup handler should warm topic sets for the new user

**Trigger:** Phase 4 (topic-sets architecture)
**Status:** deferred until signup UI exists (currently no signup flow — users are seeded via `scripts/seed.ts`)

When a sign-up flow is built, the signup handler must, immediately after creating the user row, generate that user's `current` and `next` topic sets in-line. This guarantees the new user's first home-page load is zero-latency, with no need to run a per-user warm script manually.

Implementation note: the same `lib/topicSets.ts` helpers used by the warm script and `/api/topics/reroll` should be reused — there should be one place that knows how to "ensure a user has both `current` and `next` populated." The signup handler calls it after `createUser()`.

For now (no signup), `npm run warm` is run manually. After this backlog item is done, `npm run warm` is only useful as a maintenance / repair tool.

---
