# Roadmap

Features planned **after** the conversation-mode work (`CONVERSATION_MODE_PLAN.md`) lands. Tracked here so they're not lost; explicitly out of scope for the current branch.

This file is for the *next chapter* of the product. For smaller deferrals that fall out mid-implementation of the current chapter, see `BACKLOG.md`.

---

## 1. Dashboard with multiple modes

When the user opens the app (post-login), they land on a **dashboard** instead of going straight into conversation. The dashboard surfaces the available modes as primary navigation.

- **Conversation practice** — currently the only mode. Opens what is today `app/page.tsx`'s home (greeting + topic grid).
- **Vocabulary repetition / vocabulary test** — flashcard-style review of the user's `user_unknown_words` list. Schema already supports this — just no UI yet.
  - **Storage form rule:** words must be stored in the **exact form the user encountered**, not normalised to the infinitive or lemma. If the user looks up `comió` (third-person singular preterite of *comer*), store `comió` — not `comer`. Same for past participles (`hecho`, not `hacer`), gerunds (`viviendo`), conjugated forms, plurals, gendered adjectives, etc. Rationale: the form *is* the lesson — the learner needs to recognise and produce it as-seen, and lemma collapsing erases the exact stumbling block they hit. Frequency rank lookup can still happen against the lemma internally for sorting, but the stored row preserves the surface form.
  - Implication for Phase 8 (when populating the table): no lemmatization on insert. Trim, lowercase, store.

  ### Spaced Repetition design

  Standard SRS — uses the science from SM-2 (Anki) and FSRS, simplified to a discrete-stage system. New schema columns on `user_unknown_words` (or a parallel `user_word_progress` table) when the UI lands:

  - `stage INTEGER NOT NULL DEFAULT 0` — 0 (new) → 6 (mastered)
  - `next_due_at INTEGER` — Unix timestamp when this word is next due. NULL until first review.
  - `correct_streak INTEGER NOT NULL DEFAULT 0` — count of consecutive correct answers (informational; the stage is the source of truth)
  - `lapses INTEGER NOT NULL DEFAULT 0` — total times the user got it wrong after the first correct answer (telemetry; useful for "leech" detection later)

  **Stage intervals** (when the word becomes due again after a correct answer):
  | Stage | Next due |
  |---|---|
  | 0 (new) | same day, after a short delay |
  | 1 | +1 day |
  | 2 | +3 days |
  | 3 | +7 days |
  | 4 | +14 days |
  | 5 | +30 days |
  | 6 (mastered) | +60 days (control sweep) |

  Roughly doubling per stage — the well-established SM-2 spacing. Rounded to clean numbers for UX clarity.

  **Lapse handling (wrong answer):**
  - Stage 0–2: reset to stage 0
  - Stage 3–6: drop two stages (e.g. stage 5 → stage 3)

  Reasoning: dropping all the way to 0 after a single slip is demotivating and inefficient. Two-stage drop is the standard compromise — it preserves most of the prior learning while ensuring the word gets re-reinforced soon.

  **Daily new-word soft cap:** default 10 new words/day. Soft cap, not hard — when the user crosses 10, surface a non-blocking prompt: *"You've added 10 new words today. Want to take a break, or review the ones you just learned?"* Three actions: continue, review-just-these, stop. Cognitive-load research supports this kind of nudge over hard limits.

  **Review modes** (selectable in the UI):
  - *Mixed* (default): due reviews + a small share of new words (5–10).
  - *New only*: only words at stage 0.
  - *Lapses only*: only words with `lapses > 0`, ranked by lapse count desc — i.e. the words causing the most trouble.
  - *Mastered control*: an occasional sweep over stage-6 words (one mastered word every 10 reviews, sprinkled through the queue) to catch retention failures early.

  **Mastered ≠ done.** A stage-6 word still appears occasionally (every ~60 days, plus the control-sweep mixed in earlier). If the user fails it, it drops back per the lapse rules — no special "mastered" protection.

  **Sort within a session:** due words ordered by `next_due_at ASC`, with new words sprinkled by frequency rank (most fundamental first) so the learner gets the highest-utility words first.

  ### Algorithmic future direction

  If the simple stage system feels rigid after some real usage data, swap in **FSRS** (Free Spaced Repetition Scheduler — currently the best-performing public SRS algorithm, integrated into Anki since 2024). FSRS uses continuous stability/difficulty per card and re-fits to the user's actual recall data. Higher accuracy, more complex to implement. Worth the upgrade if the discrete-stage system shows obvious gaps.

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
