import type { Metadata, Viewport } from "next";
import "./globals.css";

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
        {children}
      </body>
    </html>
  );
}
