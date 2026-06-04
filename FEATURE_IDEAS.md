# Feature Ideas

Rolling brainstorm of features that aren't on a defined roadmap yet but should be tracked. Different from `ROADMAP.md` (specific phased build) and `BACKLOG.md` (deferrals from the current phase). Items here are at the "interesting, would-be-cool" stage — not yet committed to a build plan.

Each entry has the same shape: what it is, why it's interesting, rough implementation sketch, cost ballpark, and open questions to resolve before building.

---

## 1. Auto-extract unknown words from the segment alignment

**What it is**

Right now the user has to manually tap each unknown word in the AI bubble for it to land in their vocab list. After their own turn (`/api/correct`), the segment alignment shows them which parts they got wrong — words they fell back to native for, wrong forms, missing parts. The system already *knows* what the user didn't know, it just doesn't capture it.

Idea: an LLM pass over the mismatch pairs that picks out the target-language words/segments the user didn't know, and auto-inserts them into `user_vocab` (same flow as a manual tap).

**Why it's interesting**

Reduces friction. The user doesn't have to remember to tap their mistakes. Vocab list grows organically from real production gaps.

**Implementation sketch**

- After `segment()` returns `pairs[]` in `lib/correctionPipeline.ts`, an additional LLM step (chat_light):
  - Input: pairs + the full local sentence + native language
  - Task: identify each pair where the user clearly didn't know the target-language version (mismatch where user produced native fallback, wrong word, or empty). Return the target-language segment(s) the user should have known.
  - Output: `[{ segment, source_pair_index }]`
- For each, fire `saveVocabEntry` with the segment + the local sentence as context. Goes through the standard description / lookup / comparator / ranking pipeline like a tap.

**Cost**

1 extra mini call per user turn (~$0.0001) + N save-flow chains for each extracted word (~$0.0001 per save). Typical turn with 2-3 unknown segments: ~$0.0003 total. Negligible.

**Open questions**

- Should the user see auto-extracted words flagged somewhere ("just learned: X, Y, Z")? Otherwise it's invisible.
- How aggressive? Save only "clear unknowns" (native fallback) or also subtle wrong-form cases?
- Race condition: auto-extract fires the same time the user might manually tap. Idempotent because the lowercase-collision lookup catches duplicates, but worth verifying.
- Opt-in vs always-on? Could feel intrusive if too eager.

---

## 2. Per-word breakdown in segment explanations

**What it is**

When the user taps a mismatch segment for explanation (`/api/explain`), the current V2 prompt explains the segment as one concept. If the segment is multi-word (`se debe a que`, `tener ganas de`, `haya impresionado`), the user often wants to understand the *individual* words too — not just what the whole expression means. Example from real use: user learned `se debe a que` ≈ "weil / das liegt daran dass", but wanted to know specifically what `debe` means (from `deber` = to owe / must) and how it ends up in this construction.

Idea: when the segment is multi-word and is a fixed expression, idiom, or compound construction, the explanation includes a brief word-by-word breakdown.

**Why it's interesting**

Pedagogically deeper. The user learns *why* the construction works, not just that it does. Improves retention and helps generalise to similar constructions.

**Implementation sketch**

Two paths:

- **A — extend the existing prompt**: V2 explain prompt gets a new section that says "if the segment is multi-word and is a fixed expression or compound, include a brief 1-line breakdown of each content word's contribution". Output stays plain text. Length cap stays the dynamic one.

- **B — separate "Details" toggle in UI**: the explanation popover gets a small "Details" button. Click → second LLM call with a deeper, per-word-focused prompt. Cached per segment.

A is simpler; B is more controllable / on-demand. Probably A first, B as a polish step.

**Cost**

A: same call, slightly longer output (~+50 tokens). +$0.00001 per explain.
B: +1 call per click (~$0.00012). User-driven.

**Open questions**

- Always include the breakdown, or only when the segment has ≥3 words AND is a known idiom-class construction? Heuristic: if the local segment from the LLM-aligned pair contains a known idiom-marker (auxiliary, preposition pair like "de que"), add the breakdown.
- Use a stronger model for the breakdown? Subtle etymology / grammatical decomposition might benefit from gpt-4o quality.
- How to format? Markdown with bullet per word? Inline?

---

## 3. Live grammar-tutor sidebar with mastery tracking

**What it is**

A persistent sidebar in the conversation view that watches what the user is doing in real time — what they're saying, what the AI replies, what words they tap, what they get wrong — and proactively surfaces relevant **grammar concepts** with concrete examples drawn from the current chat. Each suggestion is a small clickable card; click expands a brief teaching explanation.

Plus a per-user database of which grammar topics they've encountered (and with which concrete examples). Future suggestions consult this DB to:
- avoid re-suggesting concepts they already know
- build on previously-introduced concepts ("you already saw subjunctive perfect with `haya impresionado` — here's another use with `quizás haya llovido`")

**Why it's interesting**

Personalised pedagogical layer that uses the conversation as its teaching material. Makes grammar learning concrete instead of abstract. The mastery DB means the system gets *smarter* as the user uses it more.

**Implementation sketch**

Schema:
```sql
CREATE TABLE user_grammar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  topic TEXT NOT NULL,             -- e.g. "subjunctive perfect", "ser vs estar"
  example_target TEXT NOT NULL,    -- e.g. "haya impresionado"
  example_context TEXT NOT NULL,   -- the AI sentence it came from
  introduced_at INTEGER NOT NULL,
  reinforced_count INTEGER NOT NULL DEFAULT 0,
  user_tapped_at INTEGER           -- nullable; if set, user clicked the suggestion
);
```

Live worker (chat_light), fires on each AI message arrival:
- Inputs: latest 2-3 chat turns, list of user_grammar topics for this user
- Task: pick 0-2 grammar concepts from the latest content that:
  1. appear concretely in the chat (specific example)
  2. user either hasn't seen yet, or has seen but is at low reinforcement
- Output: `[{ topic, brief_explanation, concrete_example, why_relevant }]`

UI:
- Sidebar on right (desktop) / collapsible bottom panel (mobile)
- Newest 3-5 cards visible
- Click card → modal with full explanation
- "Got it" / "Skip" buttons feed back into the mastery DB

**Cost**

~1 call per AI message (~$0.00015). 30 turns/day = $0.005/day = $0.15/month per active user.

**Open questions**

- Granularity of "topic" (broad like "subjunctive" vs narrow like "subjunctive after `quizás`"). Probably needs taxonomy.
- Mobile layout — sidebar doesn't fit on small screens. Bottom-sheet pattern?
- How to handle "user dismissed this 3 times" — track explicit skip signal?
- Cold-start: first session has empty grammar DB → suggestions are all "new". Acceptable.
- Do we want the AI in the main chat to know about this — e.g., AI replies could deliberately use a recently-introduced concept again to reinforce? Probably v2.

---

## 4. AI tutor sidebar (free-form Q&A in the chat page)

**What it is**

In the conversation page, a small chat panel (left side or expandable toggle) where the user can type any question and get answers from gpt-4o-mini. Free-form: grammar, content, vocabulary clarifications, "what does this idiom literally mean", "how would I say X". Independent from the main conversation thread.

Acts like a tutor sitting next to the learner. Reduces context-switching (no tab-flip to a separate ChatGPT tab).

**Why it's interesting**

Removes a friction point. Many learners look things up off-platform. Keeping the lookup inside the app means we capture engagement and can use the questions as signals (what topics are unclear → grammar-tutor sidebar feeds those).

**Implementation sketch**

- New panel component, dockable (or bottom-sheet on mobile)
- Each question: one `chat_light` call. Optional context injection: the current AI bubble's content if the user toggles "use this message as context"
- Keep Q&A list during the session; clear on chat close
- v1: no streaming; just request/response with loading spinner

Could share infrastructure with the existing `/playground/chat` sandbox.

**Cost**

~$0.0001-0.0005 per question (depending on context injected). User-driven, so usage-bounded.

**Open questions**

- Should the tutor see the *current chat history* by default? Pro: more useful answers. Con: token cost, privacy of the user's own utterances.
- Mobile layout — limited screen real estate
- Markdown rendering in answers (bold, line breaks, lists)
- Voice input? Probably not v1.
- Persistence: should questions across sessions be saved? Probably no for v1; ephemeral.

---

## 5. "More info" button in word-tap popover

**What it is**

The AI bubble's tap-to-translate popover currently shows the segment + native translation. Add a small button on the right (icon like "ⓘ" or "?") that triggers a *deeper* explanation: usage, register, etymology hints, related forms, why it's used here in this specific sentence.

**Why it's interesting**

Sometimes the bare translation isn't enough. The user wants to dig deeper without leaving the chat flow. A 1-click expansion gives that.

**Implementation sketch**

- Popover layout: translation top, segment middle (if multi-word), small ⓘ button right or below
- Click ⓘ → call to `/api/word-deep-explain` (new endpoint, or extend existing translate endpoint with a `deep: true` flag)
- Server: takes `(segment, sentence, native_language)`, returns 2-3 sentences explaining the word's meaning, usage, register, etymology hint where helpful
- Cache per `(segment, sentence)` so re-clicks don't re-fetch
- The expanded explanation could go to a small inline panel under the popover, not a new modal

**Cost**

~$0.0001 per click (mini, ~150 input + ~80 output tokens). User-driven; cache makes re-clicks free.

**Open questions**

- Should the deep explanation save to the user's vocab DB as part of the description? Or stay ephemeral? Probably ephemeral (description is for sense-keying, not for full pedagogical content).
- Caching: per-user? Per-segment-globally? Probably per-segment-globally is fine — same segment+sentence = same explanation.
- Stronger model? gpt-4o would do nuanced register / etymology better. Cost goes from ~$0.0001 to ~$0.001 per click. User-clicks are explicit so this is opt-in cost, fine.

---

## 6. Onboarding placement test + tiered seed-vocab import

> **⚠️ Partially superseded.** The placement-test design here was replaced by a different approach: a disguised conversation-mode-based level assessment. See **`ONBOARDING_PLAN.md`** for the current plan. The remaining open question from this section — *should we auto-import a slice of seed-vocab into new users' decks at all, regardless of how their level was determined?* — is preserved below as a future decision, decoupled from placement.

**What it is**

When a new user signs up, run a short calibration test (~5-10 cards spanning frequency ranks 50 / 200 / 500 / 1000 / 2000) to estimate their level. Score determines what slice of a pre-computed seed-vocab list gets imported into their `user_vocab`:

- **Beginner (level ~0-30)**: import ranks 1-500 — they need the function-word foundation.
- **Intermediate (level ~30-60)**: import ranks ~400-1000 — skip the trivial (`el`, `de`, `que`) which they already know, give them mid-frequency words that are common in real conversation but rare in the chat opener pool.
- **Advanced (level 60+)**: no import — their gaps are idiosyncratic, only organic tap-collection finds them.

Optional pivot for users who already exist or want to recalibrate: surface the same test under `/vocab/calibrate` later.

**Why it's interesting**

The blanket "import top-500 for everyone" would flood an advanced user's queue with garbage they already know. SRS works *because* intervals match retrieval strength — forcing `el` onto a B2 user's daily review breaks that. Tiered seeding respects the user's existing knowledge while still solving the cold-start problem for true beginners.

The onboarding test reuses infrastructure we already have: `judgeVocabAnswer` for grading, the same card UI as the main `/vocab` mode. So the marginal build cost is the placement-logic mapping (test result → level → seed range) and the test framing UI.

**Implementation sketch**

- `seed_vocab` shared table keyed by `(language, target_word_lower)` with pre-generated `english_description`, `context_sentence`, `relevance_rank`. Generated once per language via an admin script (~$0.05 of LLM calls per language for 1000 entries).
- Onboarding flow:
  1. After signup, present a short modal: "Lass uns dein Niveau einschätzen — 5-10 schnelle Wörter".
  2. For each rank-level (50, 200, 500, 1000, 2000), show 1-2 cards drawn from `seed_vocab WHERE relevance_rank ≈ X`. User answers; judge grades.
  3. Score → level bucket → seed range.
  4. `INSERT INTO user_vocab SELECT ... FROM seed_vocab WHERE language = ? AND relevance_rank BETWEEN ? AND ?`.
- Skip / "ich kenne keins" → assume beginner, full import.
- Skip the test entirely → no import, organic-only path (current v1 default).

**Cost**

- Seed generation per language: ~$0.05 once, ~30 min admin time.
- Per-user onboarding: 5-10 judge calls = ~$0.0005 per signup.
- Per-user import: 0 LLM calls (bulk SQL INSERT).

**Open questions**

- Frequency list source for Spanish seed: Hermit Dave's `FrequencyWords` (OpenSubtitles-derived, free CSV, conversational bias) is the easiest practical option. Top ~700 → manual / LLM cleanup of inflected duplicates and typos → 500 clean lemmas. CEFR A1/A2 lists from Instituto Cervantes are an alternative pedagogical anchor.
- Castellano vs general Spanish: top 500 are identical, regional divergence starts ~rank 800-1500. General Spanish list is fine for Castellano users at this scale.
- Per-language `seed_vocab` requires Phase D of the target-language migration to be done (per-user TargetSpec). Until then, hardcode Spanish.
- What happens to the seeded vocab if a user later switches target language (Phase D edge case)? Add a `language` column to `user_vocab` so seeded rows can be filtered. Schema-cheap, future-proof.
- Daily-new-cards cap (Anki defaults to 20)? Probably no — user already controls pace via their chat frequency. Add later if feedback says queue feels overwhelming.
- Mid-stage recalibration: a B2 user who imported as A1 ends up wrongly stuck reviewing `el`. Soft-fix: a "mark this as known" button on the card lets them eject any seeded card from their queue.

**Decision for v1**

Not built. v1 is **organic-only** — user accumulates vocab by tapping in chat. Empty-state on `/vocab` after all due cards are answered: "Alles gelernt — starte einen neuen Chat, um neue Wörter zu entdecken." This avoids the placement-test build cost and the seed-list curation work, and respects existing users who don't need basic-word drilling.

The placement-test approach is the path forward whenever (a) we onboard true beginners at scale, or (b) we add a second target language and want to give learners-of-Hungarian a similar runway.

---

## Bigger ideas captured elsewhere

Some ideas grew big enough to deserve their own dedicated section in `ROADMAP.md` rather than living here as a sketch:

- **Exploration Map / gamified language journey** — see ROADMAP §4. A new map-based mode where the user plays through NPC conversations across the target country, with anti-memorisation skill rubrics, side bosses, badges/coins/XP, and major checkpoints.

When an idea here gets fleshed out enough to need a real build plan, it moves to ROADMAP and gets a one-line cross-reference here.

---

## How these ideas relate

Some of these are independent (1, 5). Others are more cohesive — (2) and (5) both extend the explanation depth in different parts of the UI; (3) and (4) both add live tutor-like layers; (1) and the existing vocab pipeline are tightly coupled. If we end up building several together, an obvious bundle:

- **"Tutor layer"**: 3 (grammar sidebar) + 4 (Q&A sidebar) + maybe 5 (deep explain). Same pedagogical theme, similar UI dock.
- **"Implicit learning"**: 1 (auto-extract) + 2 (per-word breakdown). Both extend what the system already does at correction time.

---

## Adding new ideas

When a new idea comes up: add as a new section here using the same shape. Don't worry about ordering — eventually we group / prune / promote items into ROADMAP.md once a build plan crystallises.

---

## 10. "Explain further" button on vocab cards

**What it is**

A small button on the back of a vocab card that, on tap, fetches a deeper explanation: a few example sentences in both target and native language showing the word in use, plus a short grammatical / usage note. Lazy — only fired when the user explicitly asks, so the card's main face stays short and scannable.

**Why it's interesting**

The new explain pipeline (word + word_class only, no context, no hint) keeps cards short and clean — just the meanings. But sometimes the learner wants more: how is this word actually used? In what register? What's the typical sentence shape? A separate on-demand call answers exactly that, without bloating every card with information most users won't need.

**Implementation sketch**

- New route `/api/vocab/explain-further` taking the `rowId`.
- Reads `target_word`, current `native_translation`, `word_class` from the row. **No** `context_sentence` — the further-explanation is context-independent on purpose, same as the basic translation.
- LLM call (chat_precise) with a prompt like:
  ```
  Give a learner studying {target_language} (native: {native_language})
  a deeper look at the word "{word}" ({word_class}). The basic
  translation they've already seen: "{native_translation}".
  Return:
    - 3 example sentences in {target_language}, each with a
      {native_language} translation.
    - 1-2 sentence note on usage / register / common pitfalls.
  ```
- Cache the result on the row (new columns: `further_explanation_examples_json`, `further_explanation_note`) so repeat taps are instant. Async-generate on first tap, store, return.
- UI: small "?"-icon below the translation. Tap → expandable section appears with examples + note. Collapsed by default.

**Cost**

- ~$0.002-0.005 per first-explain call (chat_precise, ~400-600 output tokens).
- Once cached, free. Most users will tap on a small fraction of cards.

**Open questions**

- When the basic translation changes (e.g. a regen via reExplainAll), should the cached further-explanation be invalidated? Probably yes — set the cache columns to null on translation update.
- Should this also work in the new themes-mode chat cards? Same row in `user_vocab` either way, so yes automatically.
- Audio for the example sentences? Out of v1 scope.
