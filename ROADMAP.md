# Roadmap

Features planned **after** the conversation-mode work (`CONVERSATION_MODE_PLAN.md`) lands. Tracked here so they're not lost; explicitly out of scope for the current branch.

This file is for the *next chapter* of the product. For smaller deferrals that fall out mid-implementation of the current chapter, see `BACKLOG.md`.

---

## 1. Dashboard with multiple modes

When the user opens the app (post-login), they land on a **dashboard** instead of going straight into conversation. The dashboard surfaces the available modes as primary navigation.

- **Conversation practice** — currently the only mode. Opens what is today `app/page.tsx`'s home (greeting + topic grid).
- **Vocabulary repetition / vocabulary test** — flashcard-style review of the user's `user_unknown_words` list, surfaced by frequency rank (most fundamental words first). Schema already supports this — just no UI yet.
  - **Storage form rule:** words must be stored in the **exact form the user encountered**, not normalised to the infinitive or lemma. If the user looks up `comió` (third-person singular preterite of *comer*), store `comió` — not `comer`. Same for past participles (`hecho`, not `hacer`), gerunds (`viviendo`), conjugated forms, plurals, gendered adjectives, etc. Rationale: the form *is* the lesson — the learner needs to recognise and produce it as-seen, and lemma collapsing erases the exact stumbling block they hit. Frequency rank lookup can still happen against the lemma internally for sorting, but the stored row preserves the surface form.
  - Implication for Phase 8 (when populating the table): no lemmatization on insert. Trim, lowercase, store.

The dashboard becomes the new `/` route; current home becomes something like `/conversation`.

---

## 2. Conversations page redesign

When the user enters **Conversation practice**, the page should put **previous conversations** at the top — primary, scannable. Below or alongside, a way to **create a new conversation**.

Two options for "new conversation":

1. **Choose a topic** — opens the topic grid (current behaviour). 4-3-2 split, re-roll, etc., as today.
2. **Quick start** — picks one topic automatically (random pick from `current` set, or a fresh single-topic LLM call) and drops you straight into chat. The chat header offers a re-roll button to jump to another topic if the auto-pick doesn't land.

The default flow can be either; let UX testing decide.

---

## 3. Re-roll inside an active chat

While in conversation mode, a small re-roll button in the header lets the user abandon the current topic and start a new one (auto-picked or via the grid). Especially useful for the "quick start" flow when the auto-pick doesn't resonate.

Implementation note: this either opens the topic grid as an overlay, or just spins a new auto-pick.

---

## Implementation notes

- Dashboard is a thin shell over existing routes — minimal new infra.
- Vocabulary mode reads from `user_unknown_words` (Phase 8). Sort by `freq_rank ASC NULLS LAST, last_seen DESC`.
- "Quick start" can reuse `getCurrentSet()` and just pick one topic at random server-side; or call the LLM for a single fresh topic.
- Conversation list reads from `conversations` table — already FK'd to user, indexed.

---
