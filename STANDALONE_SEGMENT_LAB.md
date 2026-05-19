# Standalone Segment Practice — "Mini Lab"

A dedicated page where the user can record a single sentence they're thinking about and get the full segment-correction feedback, **without an AI chat reply**. Decoupled from the conversation flow.

## What it solves

Today the segment-correction pipeline (`/api/correct` → interpret → localize → segment) only fires inside a conversation. The user has to:

1. Open a chat
2. Get an AI prompt
3. Respond to that prompt
4. See their correction

This is great for guided practice, but the user has no way to **proactively test a sentence they thought up themselves**. Common use-cases:

- "I'm about to write this WhatsApp to my Spanish friend — does it work?"
- "I want to say 'I would have come if you had called me' — is my version right?"
- "My teacher used a structure I want to imitate — let me try."

Right now those impulses get lost because there's no surface for them.

## Mechanic

```
/practice  (or /lab)
─────────────────────
[Big mic button — speak your sentence]
       │
       ▼
[Transcribe → interpret → localize → segment]
       │
       ▼
[Show CorrectionBlock — same UI as in chat]
   • Local target version on top
   • Pair-aligned segments showing what was right / wrong
   • Tap any mismatch for explanation
   • TTS playback of the corrected version
   • Optional: save this attempt as a "practiced sentence" with timestamp
       │
       ▼
[Big mic button again — record the next one]
```

No AI partner reply. No conversation. No topic. Just sentence-in, correction-out, again and again.

## Why pedagogically distinct from chat

Chat is **reactive**: the AI asks, the learner answers. Cognitive load is split between comprehension (understanding the question), planning (what do I want to say), and production (formulating it).

Lab is **proactive**: the learner brings their own intent, fully formed. Production-only practice. Closer to how speaking-out-loud-while-driving practice works.

Both modes have value. Most apps support only the reactive mode. Adding the proactive mode catches a different cognitive surface.

## Implementation

Architecture-wise this is **trivially small** — the pipeline already exists and is conversation-agnostic. `/api/correct` accepts `transcript + nativeLanguage + style + targetLanguage`, returns `CorrectionResult`. The chat flow then chains `appendMessage` and triggers an AI reply. The lab flow just **skips the chaining**.

### New page

`app/practice/page.tsx`

```tsx
// Client component
// State: { stage: "idle" | "recording" | "transcribing" | "ready"; result: CorrectionResult | null }
// Render:
//   - Mic button (re-use AudioRecorder)
//   - CorrectionBlock when result is ready (re-use)
//   - "Record another" button to reset
```

### Backend

`/api/correct` works as-is. No changes needed — the route doesn't write to the conversations table, the conversation linkage happens client-side in the chat page only.

### Optional: persistence

A "save this attempt" toggle stores the practice run for later review:

```sql
CREATE TABLE practice_attempts (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES users(id),
  transcript_raw  TEXT NOT NULL,
  local_version   TEXT NOT NULL,
  pairs_json      TEXT NOT NULL,  -- the Pair[] alignment
  created_at      INTEGER NOT NULL DEFAULT (...)
);
```

This unlocks a "review my practice" page later.

## Effort

- New page + wiring existing components: **~30-45 min**
- Optional persistence table + save UI: **+30 min**

Smallest feature on the roadmap by a wide margin. Highest ROI per minute.

## Open questions

- **Topic-aware corrections**: should the corrector know what context the sentence is intended for (formal email vs casual chat)? Probably an optional dropdown — "Tone: casual / formal / written / colloquial". Today the corrector defaults to natural-spoken.
- **Streak / gamification**: practiced ≥1 sentence per day → streak counter. Probably overdue feature-bloat for now.
- **Connection to Grammar Module**: practice attempts that surface known weak topics get the "💡 Tipp" treatment (see `GRAMMAR_MODULE.md`). Natural integration once both exist.
