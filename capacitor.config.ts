// Capacitor config — wraps the Habla web app in a native iOS shell.
//
// The `server.url` setting tells the WebView to load the live Vercel
// deployment. This means Vercel pushes flow into the app automatically:
// any code change on `main` deploys to Vercel within ~1-2 minutes, the
// next time the user opens the app the WebView pulls the fresh build.
// The Capacitor shell itself (icon, splash, plugins, version metadata)
// only needs to be re-built and re-uploaded to TestFlight when that
// native layer changes — which is rare.
//
// If you ever want to ship the app offline-capable, swap `server.url`
// for `webDir: "out"` and add `output: "export"` to next.config.ts.
// That's a much bigger change; leave it for later.

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.habla.ios",
  appName: "Habla",
  // Custom-domain or Vercel-default — update to your production URL
  // once finalised. While developing, you can point this at
  // http://192.168.x.x:3000 to load a local dev server on-device
  // (set `cleartext: true` for local non-HTTPS).
  server: {
    url: "https://habla-three.vercel.app",
    // Allows the WebView to make requests to other origins (OpenAI,
    // Vercel custom domain etc.). Without this you'd hit CORS issues.
    allowNavigation: ["*.vercel.app", "*.habla.app"],
  },
  ios: {
    // "never" → let the web app's CSS handle insets via
    // env(safe-area-inset-*). With "always", Capacitor adds its own
    // top inset which combined with CSS double-pads the WebView and
    // makes the whole page scrollable into the Dynamic Island region.
    contentInset: "never",
    scrollEnabled: true,
  },
};

export default config;
