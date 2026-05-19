# Forced-Practice iOS Keyboard

Custom iOS keyboard that forces the user to formulate their everyday messages in the target language as a precondition for sending them in their native language. Inspired by Wispr Flow's keyboard-extension UX, repurposed for language learning.

## Core mechanic — the inversion

Most translation tools work in one direction: user writes in language A, output is in language B. This idea inverts it:

- The user wants to send a message **in their native language** (e.g. German to a German friend).
- The output that gets pasted is German.
- The "price" the user pays is having to formulate the message **first in the target language** (French) via voice.
- The system interprets the spoken French (which is full of mistakes at the learner's level), shows corrections, then pastes the original German intent.

This makes the **friction asymmetric in the right direction**: the recipient sees a perfect German message (no risk of broken French embarrassing anyone), but the sender did the real production-language work to get there. Every WhatsApp message becomes a micro-practice session.

## User flow

```
[User opens Habla keyboard in WhatsApp]
       │
       ▼
[User taps the mic, dictates in French — "Demain je vais au cinéma avec Marie"]
       │
       ▼
[Backend: Whisper → /api/keyboard/transform]
       │
       ▼
[Keyboard shows Step 1 — verification in native language]
       │  "Verstanden: Ich gehe morgen mit Marie ins Kino"
       │  [✓ Yes, that's it]  [✗ Re-record]
       │
       ▼ (on confirm)
[Keyboard shows Step 2 — paste + lesson]
       │  Pastes "Ich gehe morgen mit Marie ins Kino" into the WhatsApp text field
       │  Below the keyboard: "💡 Tipp: in French, 'au cinéma' not 'à le cinéma' (au = à + le)"
```

Two-step verification on Step 1 is essential — see "Friction risk" below.

## Why this works pedagogically

- **Repeated active production, untriggered by lesson UI**: the user is not "studying" — they're sending a real message. The cognitive load is "I want to communicate this thing", not "I want to do an exercise". Way harder to procrastinate from.
- **Real-world relevance**: errors caught are errors the learner makes when they really want to express something. Not contrived textbook examples.
- **Volume**: a heavy WhatsApp user sends ~50+ messages a day. At even 1 micro-lesson per send, that's 50× the typical lesson exposure of any classroom-paced app.
- **Mistakes have no public cost**: bad French stays in the keyboard, never gets sent. Removes the social-anxiety blocker that stops most language learners from practicing.

## Friction risk — the killer if mishandled

If the AI's interpretation of the user's French is wrong, the user has to **edit French they can't yet write fluently**. That's brutal — 2-3 misses and they abandon.

### Mitigation: verify in native language first

The two-step UI confirms understanding **before** the German gets pasted. The user reads "Verstanden: ich gehe morgen mit Marie ins Kino" — a sentence in their own language, easy to evaluate. If correct → tap ✓ → German pastes. If wrong → tap ✗ → re-record French.

The user **never has to edit French to fix interpretation errors**. They re-state in French if needed, and even that's just re-recording — far easier than typing.

### Mitigation: confidence routing

```
high confidence (≥0.9):  auto-paste the German, show micro-lesson banner
medium confidence:        require Step-1 confirm
low confidence:           force re-record with "I didn't quite catch that"
```

The user can configure the threshold in settings: aggressive (more auto-paste, more risk of wrong) vs cautious (every interaction needs confirm).

### Mitigation: "send German anyway" escape hatch

If after 2-3 failed attempts the user is in a hurry, they can hit "send original" — bypass the practice, just paste a German keyboard. Removes the productivity blocker entirely while keeping the practice opt-in. Track usage; if a user hits this often, they're churning.

## One-error-per-send mechanism

The most important pedagogical detail. Each transform returns **one** highlighted lesson, not a list of all mistakes.

- LLM classifier (same one feeding the grammar module — see `GRAMMAR_MODULE.md`) picks the **most fundamental** error from the user's attempt, weighted by:
  1. Severity for their level (mid-A1 user fixing accent marks first matters less than fixing word order)
  2. Frequency in their personal error history (cycling through common ones)
  3. Time since last reminder for this topic (spaced reinforcement)
- The lesson shows: real-life example (their own sentence), short explanation, optional "try again" button to re-record with the rule in mind

This is the difference between a translate tool and a learning tool. Just translating is what Google Translate does. Surfacing exactly the right one-error-at-a-time is the value.

## iOS technical reality

iOS custom keyboards are **first-class app extensions** with hard restrictions:

| Constraint | Meaning |
|---|---|
| **Full Access permission required** | Users must opt in via Settings → Keyboards. ~30% drop-off at this gate is normal. |
| **Mic access** | Needs Full Access + `NSMicrophoneUsageDescription` in Info.plist |
| **No text-field reading** | Can't see what's already typed. Can only insert/delete. Limits some auto-context features. |
| **UI frame** | ~320×280px. Within this, full SwiftUI/UIKit freedom (animations, custom views — even a Chrome-dinosaur minigame). No fullscreen takeover. |
| **Memory cap** | Keyboards are throttled. Heavy LLM clients can't run on-device. Everything backend. |
| **App-Store review** | Strict — Apple reviews what data leaves the device. For TestFlight / sideloaded, less scrutiny. |

Two Xcode targets:
1. **Host app** (Swift / SwiftUI) — login, settings, onboarding, the "study mode" UI the existing web app provides
2. **Keyboard extension** — separate target. Communicates with host via **App Group** (shared UserDefaults for auth token, settings).

### Backend endpoint

```
POST /api/keyboard/transform
Body: {
  audioBlob: base64
  // or pre-transcribed text if user typed
  text?: string
}
Returns: {
  interpretation_native: string    // for Step-1 confirm
  target_version: string           // what the user attempted, cleaned up
  native_version: string           // what gets pasted on send
  confidence: number               // 0..1
  one_error_hint: {
    rule_id: string                // from grammar taxonomy
    title_native: string
    short_explanation_native: string
    user_segment: string           // the wrong bit
    correct_segment: string        // the right bit
  } | null                          // null if no fundamental error
}
```

Backend is the existing Habla pipeline (transcribe → interpret → localize → segment) plus the grammar classifier.

## Effort and roadmap

Real iOS engineering work — not a Capacitor wrapper. Custom keyboards are native extensions:

| Phase | What | Effort (iOS-competent dev) |
|---|---|---|
| 1 | Backend endpoint `/api/keyboard/transform` + grammar classifier | ~4-6h |
| 2 | Host app: Xcode project, login flow, settings | ~8-12h |
| 3 | Keyboard extension target, App Group plumbing, basic record + send + paste | ~12-16h |
| 4 | Two-step verify UI, error-highlight banner, settings (confidence threshold, language) | ~6-8h |
| 5 | TestFlight setup, sideload-friendly signing | ~2-4h |

**Total: ~40-50h for someone with Swift experience, ~120-160h for someone learning Swift as they go.**

Apple Developer account ($99/year) for TestFlight distribution. Without it: sideload via personal team, re-sign every 7 days.

## Pre-conditions before building

Don't build this until:

1. The **grammar classifier** (see `GRAMMAR_MODULE.md` Phase 1) is mature and reliably maps user errors to stable IDs. The keyboard depends on it. Without it, the "one error" hint is hand-wavy.
2. The **single-error-highlight mechanism** has been A/B tested in the web chat first. If the same mechanism works in-app, the keyboard is just a different surface for it.
3. The user actually wants to switch keyboards regularly. PWA + "Add to Home Screen" might be enough proof-of-concept first — opens the web app, types in target there, copies output, pastes in WhatsApp. Clunky but tests the willingness to do the workflow.

If those three pre-conditions hold, the keyboard becomes the high-leverage delivery vehicle for what was already a working mechanism.

## Open questions

- Per-user grammar profile **across devices**: keyboard sends errors, host app reads them, the web app shows them in dashboards. The grammar classifier's database is the join key.
- Voice-vs-typing: should typing in French also be allowed, or strictly voice? Voice forces production; typing allows lookup. Voice-only is the bolder bet for learning, typing-fallback is the kinder UX.
- Multi-recipient: in a group chat, what happens? Probably same — native message gets pasted, doesn't care who reads it. Worth confirming.
- Recipient-aware: if the user's contacts list shows a French-native friend, should the keyboard offer "send the French version directly" as an option? Niche but cute.
