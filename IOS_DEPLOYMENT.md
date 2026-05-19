# iOS Deployment Options

Habla is a Next.js web app today. Several paths exist to put it on iPhones in an app-like form. They differ wildly in effort, native-feel, deployment speed, and what native capabilities (mic, push, keyboards) they enable.

## Option matrix

| Option | Effort (first build) | Native-feel | Web-change deploy speed | Unlocks native features? | Cost |
|---|---|---|---|---|---|
| **PWA + Add to Home Screen** | 0h (already supported by the web app today) | 60% — slight Safari chrome on launch, no splash | Instant (Vercel push → live) | No mic in keyboard, no push on iOS (limited) | Free |
| **Capacitor WebView wrapper** | ~3-5h | 90% — own icon, splash, no URL bar, native scrolling | Instant for web changes; Capacitor itself updates via TestFlight | Yes via plugins (Camera, Notifications, Haptics) — but NOT custom keyboards | $99/yr Apple Dev |
| **React Native (rewrite UI)** | ~30-60h | 95% — fully native components | Per-change rebuild + TestFlight (~30min) | Yes, fully | $99/yr |
| **Pure SwiftUI (full rewrite)** | ~80-120h | 100% — true native | Per-change rebuild + TestFlight | Yes, fully, including custom keyboards | $99/yr |

## Capacitor — the recommended path for this app

Capacitor (by the Ionic team) wraps your existing Next.js web app inside a native iOS shell. The user sees:

- **Own app icon** on the home screen
- **Splash screen** on launch (designed by you)
- **No browser chrome** — no URL bar, no back/forward buttons, no Safari toolbar
- **Status bar** controllable (colour, light/dark style)
- **Native scrolling** with iOS momentum + bounce
- **Hardware integration** — Camera, Notifications, Haptics, Native Storage, Geolocation, Biometrics all available via Capacitor plugins

What it does NOT give you:

- **Custom Keyboard Extensions** — those are a special iOS extension type, requires native Swift code (see `KEYBOARD_EXTENSION.md`)
- **Marginally better animation perf** — for 99% of UIs invisible; only matters for game-like 60fps continuous animation
- **Native widgets** (lock-screen widgets, Today view, etc.) — niche

The "feels like Revolut / Discord / Notion" comparison holds. None of those are pure native; all use web-tech for parts of their UI. Capacitor produces an equivalent experience for a fraction of the effort.

### How web changes deploy with Capacitor

When the web app is loaded from a **remote URL** (the standard config for a published app like Habla), Capacitor's WebView opens that URL on launch. Push code to Vercel → Vercel auto-deploys → next launch sees the new version. No App Store re-submission, no TestFlight re-distribution.

The Capacitor shell itself (icon, splash, native plugins, version metadata) updates **only** when you build a new version in Xcode and push to TestFlight. But shell rarely changes — most app updates are pure web changes that need zero native rebuild.

### Distribution: TestFlight vs sideload

- **TestFlight** (recommended, $99/yr): up to 10,000 testers, 90-day build expiry, no App Store review, install via a public link. The right answer for Habla — Lavi, Donata, and you install the same TestFlight build.
- **Sideload via free Apple ID**: no $99/yr fee, but the build expires every 7 days (need to re-sign and reinstall). Painful. Only viable for self-test.

### What a Capacitor build looks like in practice

```bash
# One-time setup
npx @capacitor/cli init "Habla" "app.habla.ios"
npx cap add ios

# The capacitor.config.json points to your Vercel URL:
{
  "appId": "app.habla.ios",
  "appName": "Habla",
  "webDir": "out",         // or use server.url for remote
  "server": { "url": "https://habla.your-domain.app" }
}

# Build the iOS shell
npx cap sync ios
npx cap open ios   # opens Xcode

# In Xcode: archive → upload to App Store Connect → assign to TestFlight
```

After the first TestFlight upload, Lavi clicks a link, installs, and from then on Vercel pushes flow through to her phone automatically.

## When to skip Capacitor

If the only iOS feature you need is a **custom keyboard** (see `KEYBOARD_EXTENSION.md`), you can't avoid native Swift. The keyboard is a separate Xcode target (Extension target type "Custom Keyboard"), distributed alongside a host app. The host app could itself be Capacitor-wrapped to save UI effort, then the keyboard is the only Swift-native piece.

That hybrid (Capacitor host + Swift keyboard) is probably the most efficient path if both directions of the product matter:
- Web app + Capacitor: chat, vocab, grammar — fast iteration
- Keyboard extension: the inversion mechanic (see `KEYBOARD_EXTENSION.md`)

## Phased recommendation

1. **Now**: PWA is free and good enough for the test users (you, Donata, Lavi). Add to home screen — looks app-ish. Tests whether the mobile UX is actually usable. Fix any responsive issues found.
2. **Once mobile UX is solid**: Capacitor wrapper. ~3-5h of work. Gets you the native-feel without committing to the keyboard piece.
3. **Once Grammar Module Phase 1+1.5 are mature** (see `GRAMMAR_MODULE.md`): build the Swift custom keyboard. It depends on the classifier data, so doesn't make sense before.

Don't build (3) before (1) and (2) — the native iOS engineering investment is large enough that you want the underlying mechanics to be validated first.

## Costs

- Apple Developer Program: **$99/year** (required for TestFlight + custom keyboards)
- Capacitor itself: free, MIT-licensed
- Capacitor plugins: free, all major ones (Camera, Notifications, etc.) maintained
- Vercel hosting: unchanged from current setup
- No per-user iOS fees — TestFlight up to 10,000 users included
