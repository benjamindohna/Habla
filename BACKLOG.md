# Backlog

Things to do later — out of scope for the current phase but tracked so they don't get lost. Items here should reference the phase or feature that triggered them.

---

## Per-user target language spec

**Trigger:** Phase 4-7 (target-language threading)
**Status:** deferred until a settings UI exists or a user other than admin needs a different language

`lib/targetLanguage.ts` currently exports a single `DEFAULT_TARGET` (`Spanish` / `castellano` / `everyday`) used by every prompt. When per-user differentiation is needed:

1. Add columns to `users`: `target_language TEXT NOT NULL DEFAULT 'Spanish'`, `target_location TEXT` (nullable), `target_style TEXT NOT NULL DEFAULT 'everyday'`.
2. Add `getUserTargetLanguageSpec(userId)` to `lib/users.ts` that returns the spec for a given user, falling back to `DEFAULT_TARGET` shape for missing fields.
3. Each prompt that currently calls `describeTargetLanguage(DEFAULT_TARGET)` accepts the spec via the API (read from session) and passes it to the helper.
4. Surface dropdowns in a settings UI for the three fields. Location options are language-dependent (Spanish: Castellano / Neutral / Latino; Hungarian: none).

The prompts already read a spec — only the *source* of the spec needs to change.

---

## Signup handler should warm topic sets for the new user

**Trigger:** Phase 4 (topic-sets architecture)
**Status:** deferred until signup UI exists (currently no signup flow — users are seeded via `scripts/seed.ts`)

When a sign-up flow is built, the signup handler must, immediately after creating the user row, generate that user's `current` and `next` topic sets in-line. This guarantees the new user's first home-page load is zero-latency, with no need to run a per-user warm script manually.

Implementation note: the same `lib/topicSets.ts` helpers used by the warm script and `/api/topics/reroll` should be reused — there should be one place that knows how to "ensure a user has both `current` and `next` populated." The signup handler calls it after `createUser()`.

For now (no signup), `npm run warm` is run manually. After this backlog item is done, `npm run warm` is only useful as a maintenance / repair tool.

---
