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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
