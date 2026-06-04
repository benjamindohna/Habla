# Spanish Correction App

A web app for learning Spanish (and soon other target languages) through
voice-based conversation with adaptive correction, vocabulary tracking,
and spaced-repetition practice. Single learner per account; the AI plays
a native-speaker conversation partner and surfaces real-time grammar and
vocabulary corrections without disrupting flow.

This README is the canonical entry point for any new contributor (human
or AI). For deeper planning context see the linked MDs at the bottom.

---

## 1. What the app does — the core loop

```
User speaks in Spanish (with errors / native-language fallback)
  ↓ Whisper STT
Raw transcript
  ↓ Correction pipeline (3 LLM steps):
    1. interpret → user's intent in their native language
    2. localize → perfect Spanish version of that intent
    3. segment → word-by-word alignment showing what was right / wrong
  ↓
User sees a chat bubble with:
  - their intended meaning (native language, editable)
  - the corrected Spanish version with mismatched words highlighted
  - tap-to-explain on any mismatch
  - TTS playback of the corrected sentence
  - tap-to-translate on any AI-message word → goes into user_vocab
User clicks Done → AI generates the next reply, level-targeted.
```

Every word the user taps in an AI bubble is saved to their personal
vocabulary list (with a generated English sense-key for polysemy
handling). They can later practise that vocabulary in two modes:

- `/vocab/practice` — translate the word into their native language
- `/vocab/sentence` — use the word in a sentence that demonstrates
  understanding

Both use a spaced-repetition ladder (10 stages, 1 min → 4 years) with
per-mode progress (recognition stage independent of production stage).

A background level tracker watches the last 5 raw transcripts and
adjusts the user's level (1-100, mapped to 20 CEFR-anchored ranges)
every 24 hours.

---

## 2. Current feature set — what's actually built

### Conversation mode

- Home page with 3×3 topic grid, LLM-generated from user interests
  (4 matching + 3 stretch + 2 random), pre-rolled in pairs for instant
  re-roll, capped at 4 sets per visit
- Per-conversation chat at `/chat/[id]`, persisted in DB
- Plain-text AI bubbles with per-word tap-to-translate (popover via
  React Portal so it escapes overflow clipping)
- User bubble with full correction view (interpretation + segment
  alignment + TTS); past turns collapse into a sealed bubble showing
  only the corrected sentence
- Auto-Read TTS toggle (per-user localStorage) that auto-plays fresh
  AI + user bubbles
- "Done" button advances the conversation by calling
  `/api/converse/turn` with the corrected user text + the rich Pair[]
  alignment
- Conversation extraction on home navigation: ends the chat and
  harvests interests from the message log so the next set of topics
  drifts toward what the user actually engaged with

### Vocabulary save & practice

- Tap-to-save: each first tap on a word in an AI bubble triggers an
  async save (description-generator → polysemy comparator → insert
  + rerank). See `lib/vocabSave.ts`.
- Description-generator (`lib/vocab.ts:generateVocabDescription`)
  produces a short English sense-key per row. Preserves clitic
  pronouns and compound-tense structure for multi-word segments
  (e.g. "te haya impresionado" → "has impressed you (subjunctive
  perfect)").
- Polysemy: a row's `english_description` is the sense anchor. Same
  word in two senses → two rows with independent SRS state.
- Soft-lapse: re-tapping a word in chat halves both stage columns
  (recognition + sentence) once per 5-min cooldown; `looked_up`
  increments on every tap regardless.
- Personalised relevance ranking (3-anchor binary search > 15 rows,
  bulk sort ≤ 15). See `lib/vocabRanking.ts`.
- SRS ladder: 10 stages, intervals `[1m, 1d, 2.5d, 6d, 15d, 38d, 95d,
  240d, 600d, 1500d]`. Wrong = halve floor(stage/2). Correct = +1.
  X (sister-meaning) = no-op. See `lib/vocab.ts:STAGE_INTERVALS_SECONDS`
  + `lib/vocabSrs.ts:applyJudgeResult`.
- Two practice modes share the queue + commit infrastructure but have
  separate judge endpoints and separate stage columns:
  - `/vocab/practice` + `/api/vocab/judge` → recognition
  - `/vocab/sentence` + `/api/vocab/judge-sentence` → production
- Card-stack UI with 5 layers (`components/VocabCardStack.tsx`), 6px
  per-layer translateY peek, exit animation 80px down + opacity-0 in
  400ms, TTS speaker button on front card with per-card blob cache.
- Three-strikes flow for X: 1st → escalating message, 3rd X →
  reveal panel with commit-0. 0 (wrong) reveals immediately.
- Reveal panel shows an LLM-generated native-language translation +
  hint (`/api/vocab/explain`). Cached per row (`native_translation` +
  `native_hint` columns) after first generation.
- TTS cached per row as a BYTEA blob (`tts_audio` column). Front-card
  speaker button serves from `/api/vocab/tts`, which falls back to
  live generation on cache miss.
- Backfill script `npm run backfill-vocab-assets` for legacy rows
  without assets.

### Adaptive level tracker

- 20 CEFR-anchored ranges over the 1-100 scale, see `lib/levels.ts`.
  Each range has a short label, multi-sentence description, and 2-3
  representative target-language utterances.
- `describeLevelForPrompt(level)` injects the matching range into chat
  prompts (generateAIOpener, /api/converse/start, /api/converse/turn)
  to target message complexity.
- Per-user level shown in the home page header with an info badge.
- After every `/api/correct` call, the raw transcript is pushed into a
  per-user FIFO ring of the last 5 inputs (`users.recent_inputs_json`).
- Once 5 inputs are present AND last check was > 24h ago, an async
  level-check fires: LLM sees the 5 transcripts + current level + the
  full 1-100 scale, returns a new level clamped to ±3.

### Pipeline + infrastructure

- Centralised LLM client (`lib/llm.ts`) with `chatJSON`, `chatText`,
  `logUsage`, `logAudioUsage`. Three model tiers: `chat_light`
  (gpt-4o-mini), `chat_precise` (gpt-4o), `transcription`
  (gpt-4o-transcribe), `tts` (gpt-4o-mini-tts).
- SQLite via `better-sqlite3`, WAL mode, file at `data/habla.db`. See
  `lib/db.ts`.
- Versioned migrations in `lib/migrations/`. Runner auto-applies on
  first DB access per process. Currently at migration 0008.
- Auth: bcrypt password hashes, cookie-based sessions, JWT signed with
  `SESSION_SECRET`. See `lib/auth.ts`. Sign-up UI not yet built — new
  user accounts are inserted manually (one-off scripts or `db:studio`)
  until a sign-up flow exists.
- Migrations history:
  - 0001 baseline
  - 0002 vocab v2 (English-description-anchored)
  - 0003 vocab relevance_rank
  - 0004 messages.text_es → text_target (target-language rename)
  - 0005 drop user_vocab.lapses (write-only counter)
  - 0006 vocab assets (native_translation, native_hint, tts_audio)
  - 0007 split stage → stage + stage_sentence (per-mode SRS)
  - 0008 level tracker (recent_inputs_json, last_level_check_at)

---

## 3. Tech stack

- **Next.js 15** App Router with Server Components + Route Handlers
- **TypeScript** strict mode everywhere
- **better-sqlite3** for persistence (single-process, file-based)
- **bcryptjs** for password hashes
- **jose** for session JWT signing
- **openai** SDK for LLM + TTS + Whisper calls
- **Tailwind CSS** for styling
- **tsx** for running scripts
- Node test runner for unit tests (`tsx --test tests/*.test.ts`)

Target language is **modular but currently hardcoded** to Castellano
Spanish via `DEFAULT_TARGET` in `lib/targetLanguage.ts`. See
`TARGET_LANGUAGE_MIGRATION.md` for the migration plan to per-user
target language.

---

## 4. File structure

```
app/                              Next.js App Router root
├── page.tsx                      Home — topic grid + vocab links
├── login/page.tsx                Login form
├── chat/[id]/page.tsx            Conversation page
├── vocab/
│   ├── practice/page.tsx         Recognition mode (translate)
│   └── sentence/page.tsx         Production mode (use in sentence)
├── playground/                   Manual test pages, not user-facing
│   ├── correct-test/             Sentence-level correction sandbox
│   ├── chat/                     LLM call sandbox
│   ├── save-test/                Vocab save flow tester
│   ├── translate-compare/        On-tap translate comparison
│   └── vocab-live/               Live-polling vocab list viewer
├── api/                          Server-side route handlers
│   ├── auth/{login,logout}/      Auth endpoints
│   ├── me/                       Current user + vocab CRUD + interests
│   ├── topics/{current,reroll}/  Topic set management
│   ├── conversations/[id]/       Conversation read + extract
│   ├── converse/{start,turn}/    AI message generation
│   ├── correct/                  Full correction pipeline orchestrator
│   ├── explain/                  Mismatch-segment explainer
│   ├── transcribe/               Whisper STT
│   ├── tts/                      Chat-sentence TTS (no cache)
│   ├── vocab/
│   │   ├── queue/                Due-cards reader (mode-scoped)
│   │   ├── judge/                Recognition-mode judge (LLM, no commit)
│   │   ├── judge-sentence/       Production-mode judge
│   │   ├── commit/               SRS state writer
│   │   ├── explain/              Reveal answer (cache-aware)
│   │   └── tts/                  Vocab-card TTS (cache-aware blob)
│   └── playground/               Sandboxes for the playground pages
├── globals.css
└── layout.tsx                    Root layout

components/                       Reusable React components
├── AIBubble.tsx                  Per-word tappable AI message
├── AudioRecorder.tsx             Mic + recording UI
├── ConversationView.tsx          Chat orchestration (messages + recorder)
├── CorrectionBlock.tsx           Segment alignment + explain + TTS
├── SealedUserBubble.tsx          Past user turn, collapsed
├── TopicGrid.tsx                 3×3 topic grid
├── UserBubble.tsx                Active user turn (correction view)
└── VocabCardStack.tsx            5-layer card stack for /vocab/*

lib/                              Server-side logic
├── auth.ts                       Session JWT, getSession, login/logout
├── conversations.ts              messages + conversations CRUD
├── correctionPipeline.ts         interpret + localize + segment (V1/V2)
├── aiBubblePipeline.ts           generateAIOpener + translateWordInContext
├── db.ts                         SQLite connection + migration runner
├── generateTopics.ts             4-3-2 topic LLM call
├── topicSets.ts                  current/next set rotation + archives
├── levels.ts                     20 LEVEL_RANGES + describeLevelForPrompt
├── levelTracker.ts               pushRecentInput + runLevelCheckIfDue
├── llm.ts                        chatJSON, chatText, model tiers
├── targetLanguage.ts             DEFAULT_TARGET + describeTargetLanguage
├── users.ts                      User CRUD, native_language, interests
├── vocab.ts                      normalize + describe + judge + SRS constants
├── vocabSave.ts                  Save orchestrator (the heavy flow)
├── vocabRanking.ts               3-anchor binary insert + bulk sort
├── vocabSrs.ts                   getDueVocabQueue + applyJudgeResult
├── vocabExplain.ts               Translation + hint generator (cache-aware)
├── vocabTts.ts                   TTS audio generator (cache-aware)
├── vocabSentenceJudge.ts         Production-mode judge
└── migrations/                   Versioned SQL files (0001 ... 0008)

scripts/                          One-shot maintenance scripts
├── warm.ts                       Pre-generate topic sets per user
├── backfillVocabAssets.ts        Generate missing translation/hint/TTS
├── reExplainAll.ts               Regenerate native_translation + hint for all rows
└── regenerateAllVocab.ts         Wipe + replay vocab rows (resets SRS)

types/                            Shared TypeScript types
├── correction.ts                 Pair, CorrectionResult
└── segment.ts                    Segment (AI bubble unit)

tests/                            Node test runner unit tests
└── vocab.test.ts

middleware.ts                     Auth gate for /api/* and authenticated pages
data/habla.db                     SQLite database (gitignored)
```

---

## 5. Key data flows

### 5.1 — Correction pipeline (one user turn)

```
[Client] AudioRecorder → blob
  POST /api/transcribe (FormData with audio + nativeLanguage)
    Whisper API + native-fallback hint
  ← { transcript }

[Client] POST /api/correct { transcript, nativeLanguage, style, optional model overrides }
  Server:
    1. interpret(transcript, nativeLanguage)        chat_light, JSON
       → intended_meaning_native, confidence, notes
    2. localize({ intendedMeaning, transcript, nativeLanguage, style })  chat_precise, JSON
       → local_version_target (perfect Spanish)
    3. segment({ transcript, localVersionTarget, nativeLanguage })       chat_light, JSON V2
       → Pair[] alignment (local_segment, user_segment, is_match)
    4. pushRecentInput + void runLevelCheckIfDue (fire-and-forget)
    Returns CorrectionResult { transcript_raw, intended_meaning_native,
      local_version_target, confidence, notes_native, pairs }

[Client] CorrectionBlock renders the pairs as green chips + red overlays
[Client] User taps a mismatch → POST /api/explain { localVersionTarget, localSegment,
  userSegment, nativeLanguage }
  → markdown-formatted explanation

[Client] User clicks Done → POST /api/converse/turn
  { conversationId, userTextTarget, userRaw, segments }
  Server:
    appendMessage (user turn, including alignment for later review)
    Rebuild history → chat_light system prompt with level + topic + target
    Returns { text } for AI reply
```

### 5.2 — Vocab save flow (after on-tap translate)

```
[Client] AIBubble onTap → POST /api/playground/translate (or production successor)
  { sentence, word, wordIndex, nativeLanguage }
  → { segment, translation, indices }

[Client] AIBubble fires POST /api/me/vocab
  { segment, context: full sentence, wordIndex }

[Server] saveVocabEntry:
  1. normalizeVocab(segment) → original + lower
  2. generateVocabDescription({ target_word, context_sentence, ... })  chat_light
     → English sense-key (3-9 words, preserving clitic structure)
  3. db.SELECT user_vocab WHERE user_id = ? AND target_word_lower = ?
     a. No collision → INSERT, action='inserted'
     b. Collision(s) → compareVocabDescriptions:
        - synonym match → softLapseIfDue, action='merged'
        - different sense → INSERT polyseme, action='polysemy_inserted'
  4. rerankAfterInsert (3-anchor binary insert or bulk sort)
  5. Fire-and-forget generateAssetsAsync:
     - generateExplanation → native_translation + native_hint columns
     - generateTts → tts_audio BLOB column
```

### 5.3 — Vocab practice (per mode)

```
[Client] /vocab/practice or /vocab/sentence loads
  GET /api/vocab/queue?mode=recognition|sentence&limit=30
  Server: SQL with CASE-WHEN over per-stage interval (stage_recognition
    or stage_sentence), ORDER BY stage ASC, last_seen ASC
  → Up to 30 due cards

[Client] User types answer + Enter or click Antworten
  POST /api/vocab/judge or /api/vocab/judge-sentence
  Server: LLM judge with full prompt incl. examples
  → "1" | "X" | "0" + english_description

[Client] decisions:
  "1" → POST /api/vocab/commit { rowId, result: "1", mode }
       VocabCardStack exit animation 400ms + next card
  "X" → escalating in-line message (1st X) or reveal-with-three-x (3rd X)
  "0" → fetch /api/vocab/explain → reveal panel with native answer
        User clicks Weiter → commit "0", exit animation

Server commit:
  applyJudgeResult(rowId, userId, judge, mode)
  → stage_for_mode += 1 (clamped to MAX_STAGE) on "1"
  → stage_for_mode = floor(stage/2) on "0"
  → looked_up += 1, last_seen = now (on both 1 and 0; X = no-op)
```

### 5.4 — Level tracker (background)

```
After every /api/correct:
  pushRecentInput(userId, transcript)
    → users.recent_inputs_json appended (FIFO, max 5)
  void runLevelCheckIfDue(userId)  fire-and-forget
    Gate: 5 inputs present AND (last_level_check_at NULL or > 24h ago)
    If gate passes:
      LLM call with the full 1-100 scale + current level + 5 transcripts
      → { new_level, reasoning }
      Clamp new_level to ±3 from current
      UPDATE users SET level = ?, last_level_check_at = now
      Console log if level actually changed
```

---

## 6. Running locally

```bash
# 1. Install
npm install

# 2. .env.local — OpenAI key required
cp .env.local.example .env.local
# edit and set OPENAI_API_KEY=sk-...
# also set SESSION_SECRET=<long random string> for auth

# 3. Optional: pre-warm topic sets so the home grid is instant
npm run warm

# 4. Dev server
npm run dev
# → http://localhost:3000

# 5. Tests
npm test

# 6. Backfill vocab assets (one-shot, only needed after migration 0006
#    or for legacy rows missing native_translation / native_hint / tts_audio)
npm run backfill-vocab-assets
```

There is no bootstrap seed script — user accounts are inserted manually
via `db:studio` or one-off scripts (no sign-up UI yet). Real accounts
live in the DB; previously a `scripts/seed.ts` bulk-upserted test users,
which was removed because it would overwrite real user state on re-run.

---

## 7. Where to look next — MD navigation

The repo has a fair number of planning docs. Quick map:

| File | When to read |
|---|---|
| `README.md` (this file) | First read — current state of the app |
| `LAUNCH_PLAN.md` | Next sprint — bringing up remote test users (Spanish + Italian) with Supabase migration. Time-bound 3-4 day plan with explicit decision points. |
| `ONBOARDING_PLAN.md` | Disguised level-assessment via conversation-mode first chat (replaces the card-drill placement test in `FEATURE_IDEAS §6`). Outputs `users.level` integer 0-100; no auto-vocab-import in v1. |
| `THEMES_PLAN.md` | Goal-oriented persistent learning paths ("Themes") with chat-deployment-gated vocab progression. Replaces today's 4-3-2 Topic-Grid as the main app surface; quick-chat survives as secondary mode. Big architecture shift. |
| `ROADMAP.md` | Big-picture future. Phase 1 dashboard, Phase 2 conversations redesign, Phase 4 Exploration Map (gamified language journey), Phase 5 Rigid Mode (forced reproduction drill). Items here are committed build plans, not loose ideas. |
| `BACKLOG.md` | Items deferred during the current branch — multi-word collocation grouping bug, per-language prompt cues, comparator robustness for garbage descriptions, etc. |
| `FEATURE_IDEAS.md` | Brainstorm phase — auto-extract unknown words from corrections, per-word breakdowns, live grammar tutor sidebar, AI Q&A sidebar, "more info" word popover, onboarding placement test + tiered seed-vocab. Not yet committed to a build plan. |
| `TARGET_LANGUAGE_MIGRATION.md` | The plan to support languages beyond Spanish. Phases A + B (renames + prompt strings) are done. Phases C (per-language prompt fragments), D (per-user TargetSpec), E (UI branding) are open. LAUNCH_PLAN extends this for Italian specifically. |
| `COST_AND_SELF_HOSTING.md` | Per-call cost ranking + self-host alternatives (whisper.wasm, Web Speech API, local TTS). Background research, not active work. |
| `DISREGARDED_IDEAS.md` | Approaches that were tried and replaced — the original `native_translation` column with Phase A/B/C casing pipeline; the original vocab-by-frequency-rank schema. Kept so we don't re-tread the same paths. |
| `CONVERSATION_MODE_PLAN.md` | Historical — the original plan for the segments3-conversation branch. Most of it is now implemented (see this README for actual state). Useful for understanding why certain design decisions were made. |

---

## 8. Known limitations + open questions

Things that aren't documented elsewhere as TODOs but are real:

- **Single-language**: target language hardcoded to Spanish. See LAUNCH_PLAN
  for the Italian path.
- **Single-tenant practical**: SQLite local; no remote deployment yet.
  LAUNCH_PLAN proposes Supabase + Vercel.
- **No sign-up UI**: new accounts have to be inserted manually (one-off
  script or `db:studio`). LAUNCH_PLAN adds a sign-up form.
- **No audio consent flow**: we record without explicit consent dialog. OK
  for current single-user dev; not OK for remote test users. LAUNCH_PLAN
  adds the consent modal.
- **No password reset**: if a user forgets their password, dev has to
  bcrypt-hash a new one and write to DB.
- **Cold-start vocab**: new users start with 0 vocab. Build via organic
  tapping during chats. By design (see FEATURE_IDEAS §6 for the
  tiered-seed alternative that was considered and deferred).
- **`looked_up` column is write-only**: read nowhere in the active code,
  populated for future analytics. Same was true for `lapses`, which was
  dropped in 0005. Could drop `looked_up` similarly if it stays unused.
- **TTS Castellano-only**: TTS-instructions are hardcoded for Castellano
  Spanish accent. Other regions / languages need new instructions blocks.
  Part of Phase C in TARGET_LANGUAGE_MIGRATION.
- **No backup**: SQLite file at `data/habla.db` is on local disk only.
  If corrupted, all data lost. Supabase migration in LAUNCH_PLAN gets us
  managed backups; until then, manual `cp data/habla.db ...` is the only
  backup option.

---

## 9. Conventions

- Server-side code uses `getDb()` to access SQLite. Don't open connections
  directly — the runner ensures migrations are applied first.
- Auth-gated routes check `await getSession()` and return 401 if absent.
  Middleware in `middleware.ts` redirects browser navigation; API routes
  return JSON 401.
- All LLM calls go through `lib/llm.ts:chatJSON` or `chatText` — never
  call the OpenAI SDK directly from a route. The wrapper centralises
  cost logging, model selection, and structured-output parsing.
- Migration files are append-only. Never edit a published migration;
  add a new one instead.
- The `target_word_lower` column is the dedup key for vocab. Lowercase,
  NFC-normalised, edge-punctuation stripped. See
  `lib/vocab.ts:normalizeVocab`.
- The `english_description` is the SENSE anchor for polysemy. Two rows
  with the same `target_word_lower` but different descriptions are
  treated as different senses.
- Prompts that ship to the LLM are hand-tuned and contain worked examples;
  don't refactor them without re-validating the examples still pull
  their weight. See commits touching `lib/correctionPipeline.ts` or
  `lib/vocab.ts` for the iterative tuning history.

---

## 10. Branch

This README describes the state of the `segments3-conversation` branch
as of 2026-05-10. The branch is the active feature line — `main` lags
significantly behind. There's currently no formal "main" launch; the
LAUNCH_PLAN describes the path from branch state to first remote test
users.
