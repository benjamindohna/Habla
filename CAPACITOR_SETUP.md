# Capacitor iOS Setup — Next Steps After Code Scaffold

The npm packages, `capacitor.config.ts`, and the `ios/` Xcode project skeleton are already in the repo. This doc covers what you (as a human with the Mac in front of you) do next.

## Prerequisites

1. **Xcode installed** from the Mac App Store. ~15GB. Open it once, accept the license, let it install additional components.
2. **Apple Developer Program enrolled** ($99/yr). See main chat — needed for TestFlight, not strictly needed to just open the project in Xcode.

## Update the Vercel URL

Open `capacitor.config.ts` and replace the placeholder URL with your actual Vercel custom domain or default URL:

```ts
server: {
  url: "https://YOUR-DOMAIN-HERE",   // ← edit this
  allowNavigation: ["*.vercel.app", "*.habla.app"],
},
```

The URL is what the iOS WebView loads on launch. Every Vercel push then flows into the app automatically.

## Open the iOS project

```bash
npx cap open ios
```

This opens `ios/App/App.xcworkspace` in Xcode. From here on, work happens in Xcode.

## In Xcode — first-time setup

### 1. Signing & Capabilities

- Click the `App` target in the left sidebar
- Go to the **Signing & Capabilities** tab
- Tick **Automatically manage signing**
- Under **Team**, pick your Apple Developer team (only appears after you enrolled in the Developer Program; until then "Personal Team" is the fallback for sideload)
- The **Bundle Identifier** should already be `app.habla.ios` from our config. If you want to change it (e.g. `com.benji.habla`), do it here AND in `capacitor.config.ts`.

### 2. App Icon

Capacitor created a placeholder icon. To replace:

- Go to `App > Assets > AppIcon`
- Drag your icon files into each slot (or use a single 1024×1024 PNG and let Xcode generate the rest — newer Xcode versions support this)
- Best icon source: design in Figma, export as PNG at 1024×1024, use [appicon.co](https://appicon.co) to generate all the iOS-specific sizes

### 3. Launch screen

- `App > LaunchScreen.storyboard`
- Default is plain white with "Habla" text
- Edit if you want the launch to feel branded — usually just a background colour + logo image

### 4. Microphone permission text

Already set in `Info.plist` via our edit:
```
"Habla nimmt deine Stimme auf, um deine Sätze in der Lernsprache zu
transkribieren und zu korrigieren."
```
This is what shows when iOS asks the user for mic permission the first time.

## Build & Run on Device

1. Plug iPhone in via USB. Trust the computer on the phone if asked.
2. In Xcode, top-bar: select your iPhone as the run destination (instead of "Any iOS Device" or a simulator)
3. Click the Play ▶ button
4. First run: iOS will block the unsigned app. On iPhone, go to **Settings > General > VPN & Device Management > Developer App > Trust [Your Apple ID]**.
5. The app opens and loads your Vercel URL.

This is **sideloading**. Works as personal-use install. For others (Donata, Lavi) you need TestFlight.

## Upload to TestFlight

1. In Xcode, top-bar: switch destination from your iPhone to **Any iOS Device (arm64)**
2. Menu: **Product > Archive**
3. Wait for the build (~2-3 min)
4. When done, the Organizer opens. Click **Distribute App**.
5. Choose **App Store Connect** (not Ad Hoc, not Development)
6. Choose **Upload**, follow the prompts. Apple will validate and process the build (~5-15 min).
7. Open **App Store Connect** in your browser (https://appstoreconnect.apple.com), go to your app, **TestFlight** tab.
8. The new build appears in "iOS Builds". Status starts as "Processing" → "Ready to Submit".
9. Click the build, fill in the **What to Test** notes (just "first build, please test everything") and submit for **External Testing** review (only required for the first build of External Testing; subsequent builds are auto-approved within the same major version).
10. **External Testing review** by Apple: usually 12-48h for first build.
11. Once approved, create an **External Tester Group** (e.g. "Family"). Add Donata's and Lavi's emails as testers, or generate a **Public Link** (anyone with the URL can install).
12. Testers receive an email or click the link → install the **TestFlight app** from App Store → tap the Habla build → install on their phone.

## Web changes deploy automatically

After the TestFlight build is live, any code push to `main` deploys to Vercel within ~1-2 min. When Lavi opens Habla on her phone, the WebView fetches the freshest Vercel build. **No re-upload to TestFlight needed for web-only changes.**

Re-upload to TestFlight only when:
- You change Capacitor config (icon, splash, permissions, plugins)
- You add a native iOS feature (notifications, etc.)
- A new TestFlight build is needed because the old one expired (90-day TTL — Apple sends you a reminder email)

## Iteration loop during dev

For testing local changes on-device before pushing to Vercel:

```bash
# Run Next.js dev server with --host so iPhone can hit it
npm run dev -- -H 0.0.0.0
```

Then in `capacitor.config.ts`, change `server.url` to your Mac's LAN IP (e.g. `http://192.168.178.42:3000`), set `cleartext: true`, and re-run `npx cap sync ios`. Rebuild in Xcode. The phone now hits your dev server, not Vercel. Reset the URL when done testing.

## Recap

- npm + Capacitor config: ✅ done (this repo)
- iOS Xcode project scaffold: ✅ done (in `ios/`)
- Mic permissions in Info.plist: ✅ done
- App icon, launch screen, signing, archive, TestFlight: needs Xcode + Apple Developer account → human steps above
- Privacy policy at `/privacy`: ✅ done — link this in App Store Connect during TestFlight setup
- App Privacy Nutrition Label: see `APP_PRIVACY_LABEL.md` for exact answers
