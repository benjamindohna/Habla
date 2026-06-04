# Themes Plan — Goal-Oriented Learning Paths with Chat-Deployment Gating

**Status:** Plan, not yet built. Replaces the current 4-3-2 LLM-generated Topic-Grid as the primary learning surface. Quick-chat and single-input modes survive as secondary entry points. See "What this supersedes / restructures" at the bottom.

**Goal:** Let users create persistent, goal-oriented learning paths ("Themes") around concrete situations they want to handle in Spanish — a conversation with a specific person, a recurring scenario (bar talk about football), a goal (negotiating a flat purchase). Each Theme has its own vocabulary pool drawn from the user's global vocab universe, levels that unlock by combined SRS-and-deployment progress, and a scope-bound chat experience that prepares the user for the real situation.

## 1. Why this shape

Today's app is excellent at *opportunistic* vocabulary acquisition — the user chats, taps unknown words, SRS handles the rest. But it has no answer for the user who says "I want to be able to talk to my partner's grandmother in three months" or "I want to negotiate at the property meeting in Madrid". These are **intentional**, **scoped**, **prep-driven** learning goals. The 4-3-2 topic grid serves the opportunistic case well but cannot serve the intentional case at all — topics there are ephemeral, system-chosen, single-use chat openers.

Themes are the architecture for intentional learning. They add three things:

1. **Persistence** — a Theme is owned by the user, named, described, and lives until the user deletes it.
2. **Goal-anchored vocab** — each Theme has a curated vocabulary pool that matters *for this situation*. Words the user has already mastered (in other contexts) count toward the Theme automatically — vocab is unified globally, Themes are tags into it.
3. **Deployment gating** — Theme levels do not unlock from SRS alone. The user must demonstrate the vocabulary *in a chat scoped to this Theme*. This is the pedagogical core: recognition + recall is not fluency; deployment in context is fluency.

The result is two complementary modes side by side:
- **Themes** — goal-oriented, persistent, gated, intentional
- **Quick-chat** — open-ended, episodic, low-friction, opportunistic

Both feed the same global vocab pool. Both contribute to SRS progression on every word the user taps.

## 2. Scope (v1)

- **User-created Themes.** Three creation paths:
  - From scratch (free-text scenario + goal description)
  - From a curated catalogue of universal Themes (Smalltalk, Restaurant, Doctor's Visit, Renting a Flat, Job Interview, etc.)
  - From a personalized suggestion based on interests / chat history
- **One Theme = one chat persona/scenario context** that the AI stays loosely tied to during chat sessions.
- **Themes have Levels** (1, 2, 3, …). Each level has a target vocabulary pool (~100 words for v1 — tunable). Higher levels need to be unlocked.
- **Unified vocab pool.** Theme-vocab references existing `user_vocab` rows via m:n. A word's SRS state is global; its Theme-membership is a tag.
- **Deployment gating** based on combined criteria: SRS stage AND chat-use-count-within-this-theme.
- **Theme-scoped chat.** Soft binding via system prompt; the AI stays in-character/in-scenario but doesn't police drift.
- **Quick-chat mode preserved.** Quick-chats persist (full conversation history) but live in a separate, less prominent surface.
- **Single-input mode preserved.** The current "speak/type one sentence, get a corrected version" flow stays as a secondary affordance, intentionally low-prominence.
- **Out of v1 (planned for later):** Auto-generated higher levels via questionnaire ("which billiard table, which teams, friends' interests") — kept as Phase 2.
- **Spanish only** for v1. Per-language Theme catalogues are needed when target-language migration lands.

## 3. Concept model

```
┌────────────────────────────────────────────────────────────────┐
│  User                                                          │
│  ├── global user_vocab (existing)                             │
│  │     ├── stage (recognition) — global SRS                   │
│  │     ├── stage_sentence (production) — global SRS           │
│  │     └── … (everything else stays the same)                 │
│  │                                                             │
│  ├── themes (NEW)                                              │
│  │     ├── name                                                │
│  │     ├── scenario_description (situation)                    │
│  │     ├── goal_description (what eloquence looks like)        │
│  │     ├── persona_json (optional — when Theme is a person)    │
│  │     └── theme_levels                                        │
│  │           ├── level_number (1, 2, 3, …)                     │
│  │           ├── unlocked_at (null = locked)                   │
│  │           ├── completed_at (null = in progress / unstarted) │
│  │           └── theme_vocab (m:n → user_vocab)                │
│  │                 ├── deployments_correct (chat-use counter)  │
│  │                 └── last_deployment_at                      │
│  │                                                             │
│  └── conversations (existing, lightly extended)                │
│        ├── theme_id (NEW, nullable — null = quick-chat)        │
│        └── theme_level_id (NEW, nullable)                      │
└────────────────────────────────────────────────────────────────┘
```

A vocab row can be referenced from many Theme-levels (m:n). Its SRS stage is global — practicing it in Theme A also advances it for Theme B. Its Theme-specific progress (was it deployed in a chat *for this Theme*?) is tracked per Theme-level via `deployments_correct`.

## 4. Themes hub — the main app surface

After login, the user lands on the Themes hub. This replaces today's home page (greeting + topic grid).

**When the user has zero Themes** (post-onboarding):
```
┌──────────────────────────────────────────────┐
│  Was möchtest du auf Spanisch können?       │
│                                              │
│  Themen sind Situationen oder Ziele, bei    │
│  denen du gezielt besser werden willst.     │
│                                              │
│  [Suggested theme tile]                      │
│  [Suggested theme tile]                      │
│  [Suggested theme tile]                      │
│  …                                           │
│                                              │
│  [+ Eigenes Thema anlegen]                   │
│                                              │
│  ─────────  Oder schnell quatschen →  ──────│
└──────────────────────────────────────────────┘
```

**When the user has ≥ 1 Theme**:
```
┌──────────────────────────────────────────────┐
│  Deine Themen                    [+ neues]  │
│                                              │
│  ┌────────────┐  ┌────────────┐              │
│  │ Billard mit│  │ Wohnung in │              │
│  │ Freunden   │  │ Madrid ver-│              │
│  │ Level 2/?  │  │ handeln    │              │
│  │ 37/100 ✓   │  │ Level 1/?  │              │
│  └────────────┘  └────────────┘              │
│                                              │
│  ┌────────────┐                              │
│  │ Smalltalk  │                              │
│  │ Level 4/?  │                              │
│  │ 89/100 ✓   │                              │
│  └────────────┘                              │
│                                              │
│  ─────────  Quick chat  ────────────────────│
│  [Schnell quatschen →]                       │
│  [Einzelner Satz korrigieren →] (secondary)  │
└──────────────────────────────────────────────┘
```

Each Theme tile shows: name, current level, progress within current level (X / Y vocabulary "earned"). Tap → Theme detail page.

## 5. Creating a Theme

Three paths into Theme creation:

### 5a. Suggested catalogue (most users start here)

The "Neues Thema"-page mixes three sources:

1. **The Theme Catalogue** — a system-wide pool of pre-curated Themes, stored in a separate `theme_catalogue` table (NOT per-user). Examples: Smalltalk, Restaurant bestellen, Arzt-Besuch, Wohnung mieten, Job-Interview, Flughafen, Telefonat, Erstes Date, Heimwerker-Shop, Vorstellung neuer Freunde, Familienfeier, Sport-Smalltalk, Klassische spanische Phrasen, Reise-Smalltalk, Zahlen + Zeit. ~15-20 entries per target language, hand-authored for high quality. Each has a name, scenario_description, goal_description, and an optional pre-defined vocabulary list (so first-level generation can skip the LLM call and use a curated word list directly — see §11).
2. **Personalized suggestions** based on user interests + chat history. LLM call: "given the user's interests `{x, y, z}` and recent chat themes `{a, b}`, suggest 4-6 specific Theme ideas they'd plausibly want." Output is a list of `{title, one-sentence-pitch}`. These are NOT in the catalogue — they're generated on the fly and become user-Themes only when the user accepts.
3. **Suggestions derived from quick-chats.** If a user spent significant time in a quick-chat about, say, vacation planning, a system suggestion appears: "Du hast viel über deine Reise gesprochen — willst du daraus ein Theme machen?"

User taps a catalogue entry → it gets **copied** into the user's `themes` table (with `source = 'catalogue'` and `catalogue_id` set). The user owns the copy from that point on; subsequent edits to the catalogue entry do NOT affect already-adopted user Themes. This isolation is intentional: user progress is independent, catalogue can evolve.

User taps a personalized or quick-chat suggestion → lands in the customize-and-confirm view (same UI as from-scratch wizard, pre-filled).

**Auto-adoption for new users.** On signup, a small set of catalogue Themes flagged as "basics" (e.g. Smalltalk, Vorstellung, Zahlen + Zeit) is automatically copied into the user's `themes`. The user lands in the Themes hub with these already present, not an empty slate. They can delete what they don't want; they don't have to start from zero.

### 5b. From scratch

User taps "+ Eigenes Thema anlegen" → wizard:

```
Schritt 1 — Was ist die Situation?
[textarea, multiline]
Beispiel: "Ich gehe regelmäßig mit meinen Freunden in eine Bar in
Madrid und wir reden über Fußball — Bundesliga und La Liga. Mein
bester Freund Carlos ist Real-Madrid-Fan."

Schritt 2 — Was ist dein Ziel?
[textarea]
Beispiel: "Ich will mich locker unterhalten können, Fußball-Witze
verstehen, Meinungen über Spiele austauschen ohne Pause."

Schritt 3 — Gibt es konkrete Personen oder Details?
[textarea, optional]
Beispiel: "Carlos ist 32, Tischlermeister, hört gerne Reggaeton.
Wir gehen ins 'El Tigre' in Lavapiés."

[Theme anlegen →]
```

The wizard's three fields map to `scenario_description`, `goal_description`, and the free-form context. After submit, an LLM call generates the first Level's vocabulary pool (see §6).

### 5c. From a quick-chat

End-of-quick-chat button "Daraus ein Theme machen". The LLM pre-fills the wizard with the quick-chat content treated as the situation.

## 6. The Theme detail page

After creation, and whenever the user opens a Theme from the hub:

```
┌──────────────────────────────────────────────────┐
│  Billard mit Freunden                       ⋯  │
│                                                  │
│  ┌────────────────────────────────────────────┐ │
│  │ "Ich treffe mich Freitagabends mit Tom    │ │
│  │  und Lukas in der Spielbude in Berlin     │ │
│  │  zum Billard. Wir trinken Pils und reden  │ │
│  │  über die Bundesliga — beide sind Hertha- │ │
│  │  Fans, ich nicht."                         │ │
│  │                                            │ │
│  │  Ziel: locker mitreden, Spielzüge         │ │
│  │  ansagen, Trash-Talk auf Spanisch         │ │
│  └────────────────────────────────────────────┘ │
│                                                  │
│  [Vokabeln lernen  📚]   [Chatten  💬]         │
│                                                  │
│  Level 2  ████████░░░░  37/100                  │
│                                                  │
│  Vokabel-Beispiele: la mesa de billar, tirar,   │
│  el taco, fallar, ¡qué tiro!, el descanso       │
│                                                  │
│  Höhere Levels werden freigeschaltet, wenn du   │
│  die aktuellen Vokabeln im Chat einsetzt.       │
└──────────────────────────────────────────────────┘
```

Two main actions:

- **Vokabeln lernen** → standard SRS practice queue, **filtered to vocab in the current Theme-level**. Otherwise identical UI to today's vocab practice.
- **Chatten** → opens a new conversation tagged with `theme_id` and `theme_level_id`. AI opener is scenario/persona-anchored (see §8).

Progress bar shows: how many of the level's vocabulary have been "earned" toward unlock — see §7 for what "earned" means.

## 7. Vocabulary pool per level — generation and progression

### 7a. Generating the level's vocabulary pool

When a Theme is created (level 1), or when a level unlocks and the user opens it (levels 2+), the system generates the vocab pool:

```
LLM call (chat_precise, expensive):
  Given:
    - scenario_description
    - goal_description
    - free-form context
    - the user's existing vocab (target_word_lower list, up to 1000 most relevant)
    - the user's level (0-100)
    - level_number being generated (1 = foundational, 2 = practical, 3+ = specialised)
  
  Return:
    - 100 target-language words/phrases anchored to this scenario,
      excluding words the user already has at stage ≥ 5 (mastered) UNLESS
      they're so central to the Theme that omitting feels wrong (the LLM
      decides). Below stage 5, include — those count as "earned partial".
    - For each word: a brief context_sentence that fits this Theme.
```

After the LLM returns:
- For each word the user already has in `user_vocab`: link via the m:n `theme_vocab` table to the existing row. Don't duplicate. The user's existing SRS state and translation/hint/TTS are reused.
- For each word the user doesn't have: insert into `user_vocab` as a brand-new row (stage 0), with the context_sentence from the LLM, link via m:n. Same async asset generation as organic-tap insertion.

Cost: one expensive LLM call per level (~$0.03), plus async generation of native_translation + hint + TTS for new words (~$0.05 for 100 new words).

### 7b. What "earned" means (the deployment gating mechanism)

A vocabulary word in a Theme-level is in one of three states:

| State | Definition |
|-------|-----------|
| **Cold** | User has not deployed it in a Theme-chat, AND its SRS stage is below the threshold. |
| **Warm** | SRS stage is at or above the threshold, but not yet deployed in chat for this Theme. |
| **Earned** | SRS stage is at or above the threshold, AND the word has been deployed correctly in a chat tagged to this Theme at least once. |

The progress bar counts **earned** words. A word the user has at SRS stage 9 but never used in a Theme-chat for this Theme is still Warm, not Earned.

**Why this matters:** the user can grind vocab cards alone and never feel they've "completed" the Theme. They have to actually open the chat and use the words. That's the whole pedagogical point — fluency is deployment, not recognition.

### 7c. Level unlock condition (v1 default — tunable)

Level N+1 unlocks when the current level has:
- ≥ 80% of vocab in "Earned" state
- AND has been chatted at least 3 times within the Theme (so the user can't earn 80 vocab by speaking once and dropping 80 words into a wall-of-text)

The exact thresholds (80%, 3 chats, what counts as "deployment correct", what SRS stage is the gate) are stored in a config block, not hardcoded throughout the codebase. They will be tuned based on real user behavior in the first weeks.

**Pedagogically:** this is harder than a typical app's "complete a course" criterion, and that's deliberate. The user picked this Theme because they want real fluency. We respect that ambition.

### 7d. Deployment detection — how the AI knows a word was used correctly

When a user submits a turn in a Theme-chat, the existing correction pipeline already produces a corrected target-language version. New step: a `detectDeployments` LLM call:

```
Given:
  - the user's raw + corrected message (Spanish)
  - the list of vocabulary in this Theme-level

For each vocab item, return:
  - "correct"   — appeared verbatim (or in a clearly equivalent form) and was used in a way consistent with its meaning
  - "incorrect" — appeared but was used in a way that misunderstands the meaning, OR appeared in a clearly wrong form
  - "absent"    — did not appear in the message
```

Each `"correct"` deployment increments `theme_vocab.deployments_correct` and updates `theme_vocab.last_deployment_at`. An `"incorrect"` deployment is logged but doesn't increment — and gets surfaced gently to the user as a learning moment ("du hast 'fallar' verwendet — das passt hier nicht ganz, schau mal: …").

This is the same idea as the existing sentence-mode judge but reframed: judging deployment of *Theme-level vocab* specifically, not arbitrary vocab. Implementation is a fresh LLM call (cheap, ~$0.0005 per turn), separate from the existing correction.

## 8. The Theme-scoped chat

A Theme-chat is a regular conversation persisted in the `conversations` table, but tagged with `theme_id` and `theme_level_id`. The AI's system prompt is augmented to anchor it to the Theme:

```
SYSTEM (Theme-scoped chat):
  {existing level/style prompt}
  
  This conversation is the user's practice space for a specific
  situation they want to handle in {target_language}. Use the
  scenario below to color your messages — vocabulary, tone, register,
  and topics should stay roughly anchored to this world. If the user
  drifts off-topic, that's fine — go with them briefly, then gently
  steer back via a natural connector ("interessant, wer war denn am
  Tisch?", "und wie passt das ins Spiel?").
  
  Theme name: "{theme.name}"
  Scenario: "{theme.scenario_description}"
  Goal: "{theme.goal_description}"
  Context details: "{theme.free_form_context}"
  
  {if theme has persona_json: "You are roleplaying as someone in this
  scenario. Stay in character. Persona: {persona_json}"}
  
  Try to introduce vocabulary from the current Theme-level naturally
  — these are the words the user is learning. Don't list them or be
  artificial about it; weave them in.
  Vocabulary the user is currently learning in this Theme:
  {comma-separated list of cold + warm theme-vocab}
```

Critical design notes:
- **Soft scope-binding.** The AI does NOT refuse off-topic input or scold drift. It rolls with it and steers back gently. The user controls the chat.
- **No "test" framing.** The user isn't aware the AI is trying to introduce specific vocab. It just feels like a natural conversation in this world.
- **Persona personas live in `persona_json` only if the Theme has one.** A Smalltalk Theme has no persona. A "talk to Carlos at the bar" Theme has Carlos's age, job, music taste, etc., and the AI roleplays as Carlos.

### 8a. Vocab suggestion bar above the chat

At the top of every Theme-chat, a small persistent bar shows **3-5 vocabulary items from the current level the user hasn't earned yet** (Cold or Warm state). Critically: these are shown in the **native language**, not the target language. The user reads them as a prompt — "try to say these things in Spanish" — and discovers the target-language form through use, where the chat will steer naturally toward letting them deploy it.

```
┌──────────────────────────────────────────────────────────┐
│ Probier diese Wörter:                                    │
│  • der Spielzug    • verfehlen    • der Stoß             │
│  • am Zug sein    • die Pause                            │
└──────────────────────────────────────────────────────────┘
[chat below…]
```

Selection logic for which 3-5 to show:
- Prefer Cold (never deployed AND SRS stage low) — these need the most help.
- Then Warm (SRS stage met, never deployed). They just need to be used once to graduate to Earned.
- Skip Earned entirely.
- Within those pools, prefer higher-frequency / more-central vocab first.

The bar refreshes every 2-3 user turns (or when a deployment lands and changes a word's state). Tap on a vocab entry → small popover with the target-language form, so the user can peek at the form without it being shoved in their face.

After each user turn:
1. Existing transcription + correction pipeline runs.
2. New step: `detectDeployments` runs (§7d), updates `theme_vocab` counters.
3. The suggestion bar refreshes if any state changes occurred.
4. AI's reply is generated with the Theme-scoped prompt above.

When the user finishes a Theme-chat (back arrow or "Beenden"):
1. Existing interest-extraction can still fire (since vocab insights are useful).
2. Check whether the level's unlock condition is now met. If yes, mark the next level as unlocked and surface a celebration: "Glückwunsch — Level 2 ist offen! Schau dir die neuen Vokabeln an →".

## 9. Quick-chat mode (preserved, secondary)

Quick-chat keeps everything as it is today, with two changes:

1. **Not on the Themes hub.** Access via a small "Schnell quatschen →" link at the bottom of the hub.
2. **End-of-chat conversion offer.** When the user finishes a quick-chat with ≥ 3 user turns, an optional card appears: "Aus diesem Quick-Chat ein Theme machen?" → Wizard pre-filled from the quick-chat's content via LLM analysis.

Quick-chats are fully persisted in `conversations` (with `theme_id` null), have their own history view ("Quick-Chat-Verlauf") accessible from a menu, but don't compete with Themes for visual prominence.

The current Topic-Grid as a chat-opener picker for quick-chats is **gone**. Quick-chat starts the same way the very first conversation in the app does: empty chat, user records or types the first message, AI responds. No topic chooser, no 4-3-2 grid.

## 10. Single-input mode (preserved, hidden-ish)

The current "speak / type one sentence, get a corrected version" mode lives on as a niche affordance for "just translate this one thing" use cases. Accessed via a menu item, not from the main surface. Identical to today's flow but de-prominenced.

## 11. Schema additions

```sql
-- System-wide catalogue. Not per-user; one row defines a Theme that
-- any user can "adopt" (which copies it into their themes table).
-- Edits to catalogue rows do NOT propagate to already-adopted user
-- Themes — those are independent copies once adopted. The catalogue
-- is curated manually, not generated.
CREATE TABLE theme_catalogue (
  id                     SERIAL PRIMARY KEY,
  language               TEXT NOT NULL,   -- target language this catalogue entry is for (e.g. 'Spanish')
  name                   TEXT NOT NULL,
  scenario_description   TEXT NOT NULL,
  goal_description       TEXT NOT NULL,
  is_basic               BOOLEAN NOT NULL DEFAULT false,  -- auto-copied to new users on signup
  default_vocab_json     TEXT,            -- optional curated vocab list for Level 1 (skips LLM generation)
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  archived_at            INTEGER
);
CREATE INDEX idx_theme_catalogue_lang ON theme_catalogue(language, archived_at);

CREATE TABLE themes (
  id                     SERIAL PRIMARY KEY,
  user_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalogue_id           INTEGER REFERENCES theme_catalogue(id) ON DELETE SET NULL,
  name                   TEXT NOT NULL,
  scenario_description   TEXT NOT NULL,
  goal_description       TEXT NOT NULL,
  free_form_context      TEXT,
  persona_json           TEXT,            -- JSON for persona Themes, null otherwise
  source                 TEXT NOT NULL,   -- 'catalogue' | 'scratch' | 'quick_chat' | 'suggested'
  created_at             INTEGER NOT NULL,
  archived_at            INTEGER
);
CREATE INDEX idx_themes_user ON themes(user_id);
CREATE INDEX idx_themes_catalogue ON themes(catalogue_id);

CREATE TABLE theme_levels (
  id              SERIAL PRIMARY KEY,
  theme_id        INTEGER NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  level_number    INTEGER NOT NULL,
  unlocked_at     INTEGER,                -- null = locked
  completed_at    INTEGER,                -- null = in progress / not completed
  generated_at    INTEGER NOT NULL,       -- when LLM generated the vocab pool
  UNIQUE (theme_id, level_number)
);
CREATE INDEX idx_theme_levels_theme ON theme_levels(theme_id);

CREATE TABLE theme_vocab (
  theme_level_id        INTEGER NOT NULL REFERENCES theme_levels(id) ON DELETE CASCADE,
  user_vocab_id         INTEGER NOT NULL REFERENCES user_vocab(id) ON DELETE CASCADE,
  deployments_correct   INTEGER NOT NULL DEFAULT 0,
  last_deployment_at    INTEGER,
  added_at              INTEGER NOT NULL,
  PRIMARY KEY (theme_level_id, user_vocab_id)
);
CREATE INDEX idx_theme_vocab_vocab ON theme_vocab(user_vocab_id);
```

Extensions to existing tables:

```sql
ALTER TABLE conversations
  ADD COLUMN theme_id        INTEGER REFERENCES themes(id) ON DELETE SET NULL,
  ADD COLUMN theme_level_id  INTEGER REFERENCES theme_levels(id) ON DELETE SET NULL;
-- Both null = quick-chat.
```

The existing `topicSets`, `topics_json`, `currentSetId`, `nextSetId` columns are unused after this rolls out. Mark them as deprecated in a migration; drop in a follow-up cleanup migration once the new system is stable.

## 12. Estimated cost per Theme

- Theme creation:
  - Wizard analysis (1 call) → ~$0.001
  - Level 1 vocab pool generation → ~$0.03 (chat_precise, generates 100 entries with context_sentences)
  - Per new word: native_translation + hint generation → ~$0.0005 × ~70 new words (assume 30 already in user_vocab) = ~$0.035
  - Per new word: TTS audio → ~$0.0005 × 70 = ~$0.035
- Per Theme-chat turn:
  - Existing pipeline (transcription, correction, AI reply) → unchanged, ~$0.015
  - New `detectDeployments` call → ~$0.0005
- Per level unlock:
  - Same generation cost as level 1 → ~$0.10
- Quick-chat → Theme conversion suggestion analysis → ~$0.002

**Total new-Theme cost: ~$0.10 one-time + ~$0.0005 per chat turn.** Negligible.

## 13. Files to touch (sketch)

- `app/themes/page.tsx` (new) — Themes hub, the new home.
- `app/themes/new/page.tsx` (new) — Catalogue + personalized suggestions + free-text wizard.
- `app/themes/[id]/page.tsx` (new) — Theme detail with "lernen / chatten" buttons.
- `app/themes/[id]/chat/page.tsx` (new) — Theme-scoped chat.
- `app/quick-chat/page.tsx` (new — but reuses existing ConversationView heavily)
- `app/api/themes/create/route.ts`, `app/api/themes/[id]/route.ts`, etc.
- `app/api/themes/[id]/levels/[n]/generate/route.ts` — the vocab pool generation endpoint.
- `app/api/converse/turn/route.ts` (modify) — augment with `theme_id` and call `detectDeployments` when present.
- `lib/themeVocab.ts` (new) — vocab pool generation, "earned" / "warm" / "cold" computation, unlock check.
- `lib/themeDeployment.ts` (new) — `detectDeployments` LLM call.
- `lib/themesCatalogue.ts` (new) — hand-curated universal Themes per language.
- `lib/schema.ts` — add new tables + extensions, mark old topicSets columns deprecated.
- `lib/migrations/` — new migration creating themes + theme_levels + theme_vocab + conversations columns.
- `app/(tabs)/page.tsx` — rewrite as Themes hub.
- `components/ConversationView.tsx` — accept optional theme prop, pass into system prompt build.
- `components/ThemeTile.tsx` (new), `components/ThemeProgressBar.tsx` (new), …

## 14. Phasing within the v1 build

Even within v1, suggest building in this order so something is usable early:

1. **Phase A — Schema + Theme CRUD + Catalogue table.** All four new tables: `theme_catalogue`, `themes`, `theme_levels`, `theme_vocab`. Catalogue rows hand-seeded for the first 8-10 entries (Smalltalk, Restaurant, Vorstellung, Zahlen + Zeit, Reise-Smalltalk, Familienfeier, …). Basic UI to create a Theme from-scratch wizard. The Themes hub renders the user's themes (empty for now or the auto-copied basics if implemented in this phase). Vocab pool generation for Level 1 (LLM call OR via `default_vocab_json` shortcut from the catalogue entry).
2. **Phase B — Catalogue browsing + adoption + auto-basics.** "Neues Thema"-page shows the catalogue grid. Tap → row copied into user's themes. New-user signup hook auto-copies catalogue rows flagged `is_basic = true`. Personalized + quick-chat-derived suggestions deferred to Phase D.
3. **Phase C — Theme-scoped chat + vocab linking + suggestion bar.** Theme-chat works with the scenario/persona system prompt. Vocab gets linked to theme_vocab on the right context. detectDeployments runs. Suggestion bar above the chat shows 3-5 cold/warm vocab in native language. Vocab review filtered to current Theme-level.
4. **Phase D — Level unlock + progression UI + personalized suggestions.** Unlock condition, progress bar, "level 2 freigeschaltet"-celebration. Personalized "neues Thema"-suggestions LLM call now too.
5. **Phase E — Quick-chat → Theme conversion.** End-of-quick-chat offer.

A user on the day Phase A ships can already create a Theme from scratch and start the chat. Phase B opens the catalogue and gives new users a sensible default deck. Phase C unlocks the deployment-driven progression mechanic. Each phase is shippable independently.

## 15. Out of v1 / Phase 2 ideas

- **AI-driven level expansion via questionnaires.** Once a user completes a few levels of a Theme, the system asks deepening questions ("How old are your friends? Which teams? Do you play yourself?") to generate higher-level vocab that's increasingly personalized. This is the user's original "questionnaire" idea — strong, but a Phase 2 build.
- **Theme sharing.** Letting users share Themes with others ("here's the Theme I built for 'beach Spanish' — try it"). Community Themes.
- **Cross-Theme analytics.** "You've mastered 80% of vocabulary across all your Themes." Aggregated progress dashboards.
- **Theme expiry / archival.** Themes that haven't been touched in N months get archived gracefully.
- **Spaced re-encounter of mastered Themes.** A Theme the user completed 6 months ago — surface it again with a "control sweep" chat to verify retention.

## 16. Open questions

- **Catalogue curation:** the catalogue lives in the `theme_catalogue` table, hand-authored for each target language. ~15-20 entries to start. Maintenance burden is small but non-zero. A simple admin route (`/admin/catalogue`) for editing entries would help long-term; manual SQL is fine for v1.
- **Multiple active levels per Theme:** can a user practice Theme A Level 2 vocab while Level 3 is also unlocked but not started? Probably yes — let them pick which level to practice. Easy.
- **What happens to vocab when a Theme is deleted?** Theme rows go, but the underlying `user_vocab` rows stay. The vocab the user learned doesn't disappear from their global pool. (`theme_vocab` cascade-deletes, `user_vocab` is independent.)
- **Quick-chats and unknown words:** when a user taps a word in a quick-chat, that vocab gets added to `user_vocab` with no Theme tag. Good — global pool grows organically. If they later add a Theme covering similar territory, the new Theme can already link those words at generation time.
- **Should the user see which words are "cold / warm / earned"?** In the Theme detail page, yes — at least as a brief tag on each card in the vocab review. Helps the user understand the deployment gating.
- **What if the LLM-generated vocab pool feels wrong?** Add a "regenerate vocabulary for this level" button (Theme-detail menu). Costs ~$0.05, but worth having for the first weeks while we tune the generation prompt.
- **"Klassische spanische Phrasen"-style Themes have a deployment-gating weakness.** If the Theme's vocab is mostly fixed idiomatic phrases ("¡Qué lástima!", "no pasa nada", "vale"), they don't naturally appear in free-flowing conversation. The deployment-gating mechanic struggles here: the user might never get to use them organically. **For v1 we accept this** — the suggestion bar at the top of the chat (§8a) gives the user a nudge, but the conversation stays generic and drift is fine. A future iteration could add an explicit "Phrasen-Drill"-mode for these special Themes that prompts the user to use a specific phrase per AI turn. Not a v1 concern; flagged as known limitation.
- **Catalogue updates after adoption.** If we improve the scenario text on a catalogue entry, already-adopted user copies don't pick up the change. Probably fine — users own their copies — but worth thinking about whether a soft "this catalogue has been updated, refresh your copy?" hint should exist. v2 question.

## 17. What this supersedes / restructures

- **`CONVERSATION_MODE_PLAN.md` Phase 3 & 4 (Topic Generation, Topic Preload):** the entire 4-3-2 LLM-generated Topic-Grid system is removed as the primary chat-opener mechanism. Document should be updated to mark these as "implemented in v1 of conversation mode, removed in Themes v1."
- **`lib/topicSets.ts`, `lib/generateTopics.ts`, `app/api/topics/*`:** functionally retired (kept only briefly during transition).
- **Existing `topicSets` table, `users.currentSetId`, `users.nextSetId`:** marked deprecated in migration, dropped in follow-up.
- **`scripts/warm.ts`:** retired — Themes don't need preloading; their levels are generated on-demand at unlock time.
- **`FEATURE_IDEAS §6` (placement test) + `ONBOARDING_PLAN.md`:** unaffected — the onboarding still produces a `users.level` integer, which is just one of the inputs to Theme-level vocab generation. The two systems compose cleanly.

The episodic-conversation muscle of the app survives in Quick-chat mode. The intentional-learning muscle is new. Both coexist, the latter prominent.
