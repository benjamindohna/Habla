# Motivation Dashboard

Ideas for a home-page dashboard that surfaces what the user did this week, projects when they'll hit fluency, and tracks a configurable streak. Goal: a learner opens the app and immediately sees signal that they're moving forward, with a concrete reason to come back tomorrow.

This file is brainstorm, not a build spec. The shape is intentionally loose so we can pick which pieces to ship in which order. Each piece is annotated with what data already exists vs. what needs new tracking.

---

## Why bother

Two failure modes for a language-learning app:
- **Silent quits**: user installs, uses for a few days, drops off. No visible progress → no reason to return.
- **Hollow engagement**: gamified hooks (streaks, badges) that feel like a treadmill, disconnected from real progress. Duolingo's flame icon makes you feel guilty without making you fluent.

The dashboard's job is to make **real progress legible** — show the user, in plain numbers and a line graph, that they're closer to their goal than they were last week. The motivation is the truth, not the reward animation.

---

## Pieces

### A. Weekly recap card

A small block at the top of the home page (above "Neuen Chat starten") with this-week vs. last-week comparison:

```
Diese Woche                Vorwoche
─────────                 ─────────
12 Konversationen         8       (+4)
47 eigene Sätze           31      (+16)
23 neue Vokabeln          19      (+4)
89% Vokabeln richtig      82%     (+7%)
Level 12 (+1)
```

**Data we already have:**
- Conversations: `conversations` table, count by `user_id` + `created_at >= ?`.
- User turns: `messages` where `role = 'user'` joined to user's conversations.
- New vocab: `user_vocab` filter by `created_at`.
- Level changes: `users.last_level_check_at` + the level itself. Could enrich by logging old/new on each level check.

**Data we'd need to add:**
- Vocab review outcomes timestamped. Today the `correct_streak` and `stage` fields tell you the current state of a card, not the history. A small `vocab_review_log` table (row per attempt: row_id, verdict, mode, timestamp) would unlock "X% correct this week" cleanly. Cost: a few KB per user per week.

### B. Fluency projection

A simple line graph: x-axis = time (past 30 days + projected 90 days), y-axis = level (1-100). The past is the actual user level over time; the projection is a straight line extrapolating their last 30-day slope to the future. Target levels marked with horizontal lines (e.g. "Level 60 — fließend").

```
100 ┤
 80 ┤
 60 ┤- - - - - - - - - - - - - - ╱ ─ ─ ─ Fluency goal
    │                          ╱
 40 ┤                       ╱
 20 ┤                    ╱
    │ ●●●●●●●●●● — — —
  0 └─────────────────────────────────
       past 30d        next 90d
```

The dashed projection line lives in real-time: every chat / vocab session that bumps the level extends the past line and recomputes the slope. Headline: **"Wenn du in deinem aktuellen Tempo weitermachst, erreichst du Level 60 in ~7 Wochen."**

Honest about uncertainty: the projection is naive linear extrapolation. Slope dips and bumps happen. The point isn't accuracy — it's making the trajectory visible.

**Data we already have:**
- Current level + `last_level_check_at`. Updated every 24h max.

**Data we'd need to add:**
- A level history table. Today only the current level is stored. To draw the past line you need (timestamp, level) pairs. Append on every `runLevelCheckIfDue` call. Cheap: 1 row every 24h per user.

### C. Streak

User's suggested definition: per day, hit all of these to keep the streak alive:
- 5 chats
- 5 user turns within those chats (i.e. don't just open the app, actually speak)
- 5 newly-learned vocab
- 10 correctly-answered vocab review (any mode)

This is well-shaped because it's **multi-modal** — you can't gimmick it by spamming chat or grinding flashcards alone. You have to do both real conversation AND review.

Streak display: small chip in the header `🔥 7 Tage`. Tap → expand into a per-day-of-week grid showing which days hit / didn't hit, plus today's progress bar toward each of the four targets.

**Important: don't make it punishing.** If the user breaks the streak, no guilt-tripping notification. Just reset and start again. The streak is a motivator, not a stick.

Configurable defaults — the four numbers (5 / 5 / 5 / 10) should be per-user, set during onboarding (see section D). Default targets should be approachable; the user can crank them up if they want a real challenge.

**Data we already have:** everything needed (chats, turns, new vocab, vocab review outcomes once logging exists per piece B).

**Data we'd need to add:** a `user_streak_targets` row per user (or just columns on `users`) for the four numbers + the current streak count + the last-completed-day timestamp.

### D. Onboarding questionnaire (sets realistic targets)

When a new user signs up, a quick 4-5 question wizard before they hit the home page. Goal: figure out realistic daily targets without overwhelming them.

Questions:

1. **Wie viel Zeit pro Tag willst du investieren?**
   - 5 min (very light)
   - 10-15 min (light)
   - 20-30 min (regular)
   - 45+ min (serious)

2. **Wann erwartest du, dass du fließend sprechen kannst?**
   - In 3 Monaten (very intense pace required)
   - In 6 Monaten (intense)
   - In einem Jahr (realistic)
   - Kein bestimmtes Ziel (just enjoy)

3. **Wie nimmst du dir das selbst übel, wenn du einen Tag aussetzt?**
   - Sehr leicht (kein Stress)
   - Mittel (gerne Erinnerungen)
   - Stark (push me)

4. **(optional) Magst du Streaks und Zahlen, oder schreckt dich das ab?**
   - Liebe ich (zeige groß)
   - Akzeptabel (zeige klein)
   - Bitte ausblenden (gib mir keine Zahlen)

From those answers we set:
- Daily streak targets (chats, turns, new vocab, vocab correct) — light combos for "5 min" answers, ambitious for "45+ min".
- Projection target level by date — from question 2.
- Notification cadence — from question 3.
- Dashboard density — from question 4.

The user can change all of these later in a settings page; the questionnaire just bootstraps a sensible default.

### E. Live-extension of the dashboard

Every action on the app (new conversation, completed user turn, vocab learned, vocab reviewed) should immediately update the dashboard tile without a refresh. Easiest implementation: the home page polls `/api/dashboard/summary` every time it gains focus (Page Visibility API). For a real-time feel during a long session: server-sent events or a thin websocket — but polling-on-focus is enough to start.

### F. Motivational micro-copy

Tiny strings under the recap card that change weekly based on the data:
- "Du hast diese Woche 50% mehr gesprochen als letzte." — when user turns grew significantly
- "Dein bestes Wort: **el canto**. 5× richtig in Folge." — surface a recent win
- "Du hast noch nie so viele Tage in Folge geübt." — celebrate streak milestones
- "Wenn du die nächsten 30 Tage durchhältst, bist du auf Level X." — at month milestones

Be specific. Never generic praise ("Gut gemacht!"). Always tie the message to a concrete number from the user's data.

### G. What NOT to build

- **Daily reminder pushes that say "Du verlierst deinen Streak in 2 Stunden!"** — pure anxiety, not motivation. Skip.
- **Badges / achievement medals** — feels infantilising for adults learning a real skill. The line graph and weekly numbers carry the same weight without the kitsch.
- **Social leaderboards** — language learning is personal. Comparing to other users is mostly demotivating.
- **Heatmap calendars (GitHub-style)** — visually clever but adds little once you have the streak + projection. Could be a future Settings/Detail page, not the dashboard centre.

---

## Implementation order (if we built this)

A reasonable order, smallest first:

1. **Weekly recap card** (no new DB tables; ~2h to build + style).
2. **Vocab review log** (one new table, write on every judge verdict; unlocks accurate streak + recap %).
3. **Level history log** (one new table, write on every level check; unlocks projection).
4. **Fluency projection graph** (chart library + extrapolation logic; ~3-4h).
5. **Streak system** with defaults (no onboarding yet; ~2h).
6. **Onboarding questionnaire** (~2-3h).
7. **Configurable streak targets in settings** (~1h once questionnaire exists).
8. **Motivational micro-copy** (rule-based, no LLM; ~1h).

Total if built end-to-end: ~12-15 hours. None of it is technically hard; the design work is in picking the right numbers and tone.

---

## Open questions

- **What's the "fluency" level number?** 60 felt right earlier. Should it be configurable in the questionnaire? Recommend yes — let the user pick their goal level explicitly, with descriptions ("conversational" / "fluent in most situations" / "near-native").
- **Streak across multiple devices?** Today user_id is per-account, so cross-device streak is implicit. Confirmed not an issue.
- **What about a "rest day" that doesn't break the streak?** Duolingo has streak-freeze items. Could be simpler: one rest day per week that doesn't reset the count. Tone-wise this is friendly without being gamey.
- **Should the projection take into account the level-tracker's max ±3 step?** Probably not — at 30-day windows the cap doesn't bind anymore. Linear extrapolation is fine.
- **Onboarding flow before or after target language picker?** If we re-add target-language switching later, integrate both into one wizard.
