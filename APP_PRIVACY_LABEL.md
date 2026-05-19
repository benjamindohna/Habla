# Apple App Privacy Nutrition Label — Fill-In Cheat-Sheet

When you set up the app in App Store Connect (or even just External TestFlight), Apple walks you through 4-5 screens asking what data you collect, how it's used, and whether it's linked to user identity. Here are the exact answers for Habla, based on the actual data flow described in `/privacy`.

## Screen 1: Data Collection Overview

Apple asks: **"Does your app collect data?"**

→ **Yes**

## Screen 2: Data Categories

Apple shows a long list of category checkboxes. Tick exactly these:

### Contact Info
- [x] **Email Address**

### Identifiers
- [x] **User ID** (the internal user_id row, used for the auth session)

### User Content
- [x] **Audio Data** (voice recordings for speech-to-text)
- [x] **Other User Content** (chat transcripts, vocab entries, level data)

### Usage Data
- (none — we don't track session count, button taps, screen views, etc.)

### Diagnostics
- [x] **Crash Data** (Vercel logs technical errors automatically)
- [x] **Performance Data** (response timing in logs)

Everything else: leave unchecked. Specifically:
- [ ] Health & Fitness — no
- [ ] Financial Info — no
- [ ] Location — no
- [ ] Sensitive Info — no
- [ ] Contacts — no
- [ ] Browsing History — no
- [ ] Purchases — no
- [ ] Search History — no
- [ ] Other Identifiers (Advertising IDs etc.) — no

## Screen 3: For each ticked category, "How is this data used?"

Apple asks per-category what the **purpose** is. For all categories ticked above, the answer is the same:

→ **App Functionality** (only)

Specifically NOT:
- [ ] Third-Party Advertising
- [ ] Developer's Advertising or Marketing
- [ ] Analytics
- [ ] Product Personalization (this is borderline — we adapt level based on user samples; but it's about app function not advertising personalization, so technically still App Functionality is correct)
- [ ] Other Purposes

## Screen 4: For each category, "Is data linked to the user's identity?"

Per Apple's definition: data is "linked" if you can connect it to a user's identity (account, email, device ID, etc.). For Habla:

| Category | Linked? | Why |
|---|---|---|
| Email Address | **Yes** — it's the user's account identifier |
| User ID | **Yes** — it IS the identifier |
| Audio Data | **Yes** — stored under user_id |
| Other User Content | **Yes** — stored under user_id |
| Crash Data | **No** — Vercel collects crash data per-request, not per-user |
| Performance Data | **No** — same reason |

## Screen 5: "Is data used to track users across other companies' apps and websites?"

→ **No, for all categories.**

Tracking in Apple's sense means cross-app/cross-website attribution. We don't do any of that — no advertising IDs, no analytics SDKs, no Facebook pixel. The audio data leaves to OpenAI but that's for **processing**, not for tracking — different concept.

## Privacy Policy URL

Apple asks for a public URL to your privacy policy. Use:

```
https://your-vercel-domain.app/privacy
```

(replacing with whatever your custom domain is)

## Microphone / Speech Recognition usage strings

These go in your iOS app's `Info.plist`, not the App Store Connect nutrition label, but Apple checks they exist and are honest:

```
NSMicrophoneUsageDescription:
Habla nimmt deine Stimme auf, um deine Sätze in der Lernsprache zu
transkribieren und zu korrigieren.

NSSpeechRecognitionUsageDescription:
(Only needed if using on-device speech recognition. We use server-side
Whisper via OpenAI, so this string is optional — but if Apple flags
it, use:)
Habla nutzt Spracherkennung, um deine Aufnahmen in Text umzuwandeln
und mit der korrekten Form deiner Lernsprache zu vergleichen.
```

## What Apple Reviewer might ask

Specifically for the keyboard extension when you add it later — but not for the initial Capacitor-only build:

- **Justify "Full Access" need**: explain that the keyboard sends audio to your backend for AI transcription/translation. Without Full Access, no network = no functionality.
- **Demo Account**: include a `reviewer@habla.app` test account with a German native language and Spanish target, so the reviewer can play with the app without signing up.
- **Reproduction steps**: 1) sign in 2) tap "Neuen Chat starten" 3) tap mic, say something 4) see the correction. Boring is good — reviewers like clear flows.

## Sub-processor disclosures

For GDPR completeness (not strictly Apple's concern), the `/privacy` page already names OpenAI, Vercel, Neon. If you ever add another sub-processor (Cloudflare, an analytics tool, Stripe etc.), update `/privacy` and re-submit the nutrition label.

## Re-submission triggers

You need to update the nutrition label when:
- You add a new data category (e.g. you add geolocation later)
- You change purposes (e.g. you add analytics)
- You add new sub-processors

You do NOT need to update when:
- You add new features that use the same data types
- You update the UI
- You scale to more users
