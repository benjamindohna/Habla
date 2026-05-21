"use client";

// One-time native-plugin configuration on app start. Renders nothing —
// just runs side-effects on mount. Lives in the root layout so it
// fires once per session.
//
// Currently configures the iOS keyboard:
//   1. resize: "none" (also in capacitor.config.ts) — keyboard overlays
//      the WebView instead of resizing or scrolling it.
//   2. setScroll({ isDisabled: true }) — turns off WKWebView's
//      "scroll-into-view on focus" behaviour. Without this, focusing an
//      input near the top of the page still triggers the OS to nudge
//      the document upwards, which on iPhones with a Dynamic Island
//      exposes the unsafe top zone behind it.
//
// Web Safari (Capacitor.isNativePlatform() === false) is unaffected —
// the import is dynamic, the calls only fire when running natively.

import { useEffect } from "react";

export default function CapacitorBoot() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;
        const { Keyboard } = await import("@capacitor/keyboard");
        if (cancelled) return;
        // The two calls are independent — disabling scroll-into-view
        // is the load-bearing one for the Dynamic Island issue.
        await Keyboard.setScroll({ isDisabled: true });
      } catch (err) {
        // Plugin not installed (web-only deploy) or older native shell.
        // Safe to ignore; the web-only fallback path still works.
        console.warn("[CapacitorBoot] keyboard plugin unavailable", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
