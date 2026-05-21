import type { Metadata, Viewport } from "next";
import "./globals.css";
import CapacitorBoot from "@/components/CapacitorBoot";

export const metadata: Metadata = {
  title: "Habla",
  description: "Sprich, lerne — sofort korrigiert.",
};

export const viewport: Viewport = {
  // viewportFit "cover" + the safe-area CSS handling in globals.css
  // lets the WebView paint behind the Dynamic Island while keeping
  // content positioned correctly via env(safe-area-inset-*).
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // resizes-content: when the soft keyboard opens, shrink the layout
  // viewport itself instead of scrolling the existing layout up. This
  // is the modern fix for the iOS pain where the page would shift up
  // on focus (pushing content behind the Dynamic Island) and never
  // reset on blur. With this set, the page stays anchored and only
  // the visible area shrinks while the keyboard is up.
  interactiveWidget: "resizes-content",
};

// Inline detection: are we running inside the Capacitor WebView (native
// iOS app) or in a regular browser like Safari? Sets `html.capacitor`
// before first paint so the safe-area CSS in globals.css can branch.
// In Capacitor the WebView paints behind the Dynamic Island, so we
// need a hard 60px top-floor fallback. In Safari the browser chrome
// already sits below the island, so any extra floor produces a visible
// gap. Sniffing via window.Capacitor + UA covers both Capacitor 5/6
// initialisation orderings.
const CAPACITOR_DETECT = `if(window.Capacitor||/Capacitor/i.test(navigator.userAgent)){document.documentElement.classList.add('capacitor')}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: CAPACITOR_DETECT }} />
      </head>
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        <CapacitorBoot />
        {children}
      </body>
    </html>
  );
}
