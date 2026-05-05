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

## Collapse user-turn correction view on Done; show as sealed bubble

**Trigger:** Phase 6 / 7 (chat shell + turn loop)
**Status:** UX refinement, deferred

When the user clicks **Done** on their correction box, the whole correction UI (interpretation line + segment chips + tap-to-explain panel + Done button) should **collapse / disappear**. In its place, the user's turn should render as a **clean, sealed speech bubble** — Spanish-only, just `local_version_es`, mirroring the visual style of the AI bubble but right-aligned. The conversation should look like a real chat once a turn is "finished".

- No animation needed initially; just swap the rich correction view for the closed bubble on Done.
- The full correction is still in the DB (`messages.segments_json`) — could be re-expandable later via a small "review correction" affordance on the bubble. Out of scope for this initial pass.
- The latest unfinished user turn keeps its full correction view. Earlier user turns are all sealed bubbles.

---

## Tap-to-translate visual polish

**Trigger:** Phase 8 (tap-to-translate on AI bubbles)
**Status:** UX refinement, deferred

The current tap-state visual on AI-bubble words doesn't feel right. Specifically:

1. **Tap-to-open visual** — the amber background looks rough; needs a more elegant treatment for the active word that draws attention without feeling jarring.
2. **Looked-up marker** — the dotted underline on already-tapped words is too faint to notice. Replace with a real **highlighter marker** treatment: a soft background colour around the word (think yellow/green highlighter pen, but tasteful). Should be unmistakable but not aggressive.
3. **Tooltip styling** — current black tooltip with arrow is fine but worth iterating once the rest of the design language settles.

---

## Multi-word collocation grouping is unreliable

**Trigger:** Phase 8 (segment generation prompt)
**Status:** known bug

The LLM is told to group multi-word idioms and tightly-bound collocations as a single tappable segment. In practice it often fails — splitting *por ejemplo*, *tener ganas*, etc. into individual words that don't translate sensibly on their own.

Likely fixes (in order of effort):

1. **Tighten the prompt** with more concrete `${TARGET_LANGUAGE}`-specific examples and stricter language ("MUST keep these together: …"). Cheapest, but the model still drifts.
2. **Post-process server-side**: after the LLM returns segments, run a small follow-up call asking *"are any adjacent segments here a fixed expression that should be merged? If yes, return the merged version."* Adds a second LLM call, but more reliable.
3. **Maintain a per-language idiom list** (`lib/idioms.es.txt` style) and merge adjacent segments that match it, deterministically. Most reliable, no LLM cost — but list maintenance.

Probably (1) first; if it stays flaky, do (3).

---
