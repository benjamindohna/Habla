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

/** True while an editable element still has focus — e.g. the user
 *  jumped from one input straight into another; the keyboard stays up
 *  and resetting the scroll would yank the focused field out of view. */
function editableFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
}

export default function CapacitorBoot() {
  // Document-scroll watchdog for the iOS keyboard.
  //
  // The app's outer scroll is locked (body overflow hidden, the real
  // scrolling happens inside <main>), so document scrollY MUST be 0 at
  // all times. WKWebView disagrees: despite Keyboard resize "none" +
  // setScroll({isDisabled}) it still nudges the document upward when
  // an input focuses, and on keyboard dismiss it restores that scroll
  // imperfectly — the page stays shifted a few px up, pushing the
  // header behind the Dynamic Island and off the tappable area.
  //
  // Since 0 is the only legitimate document scroll position, the fix
  // is a hard reset whenever the keyboard goes away. Two triggers,
  // staggered timeouts because iOS restores asynchronously:
  //   - focusout from any editable (unless focus moved to another one)
  //   - visualViewport resize back to (near) full height
  // Runs on web Safari too — same bug exists in the PWA; on desktop
  // scrollY is already 0, so the reset is a no-op.
  useEffect(() => {
    function resetScroll() {
      if (editableFocused()) return;
      if (
        window.scrollY !== 0 ||
        document.documentElement.scrollTop !== 0 ||
        document.body.scrollTop !== 0
      ) {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }
    }
    function scheduleReset() {
      // 50ms: normal dismiss. 350ms: covers the keyboard's close
      // animation when iOS applies its restore late.
      setTimeout(resetScroll, 50);
      setTimeout(resetScroll, 350);
    }
    function onFocusOut() {
      scheduleReset();
    }
    const vv = window.visualViewport;
    function onViewportResize() {
      if (!vv) return;
      // Keyboard gone ≈ visual viewport back to (almost) layout height.
      if (window.innerHeight - vv.height < 60) scheduleReset();
    }
    document.addEventListener("focusout", onFocusOut);
    vv?.addEventListener("resize", onViewportResize);
    return () => {
      document.removeEventListener("focusout", onFocusOut);
      vv?.removeEventListener("resize", onViewportResize);
    };
  }, []);

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
