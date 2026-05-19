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
    url: "https://habla-six.vercel.app",
    // Allows the WebView to make requests to other origins (OpenAI,
    // Vercel custom domain etc.). Without this you'd hit CORS issues.
    allowNavigation: ["*.vercel.app", "*.habla.app"],
  },
  ios: {
    contentInset: "always",
    // Keep the keyboard from pushing content up too aggressively —
    // we have our own scroll handling.
    scrollEnabled: true,
  },
};

export default config;
