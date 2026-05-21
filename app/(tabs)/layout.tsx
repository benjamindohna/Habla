// Shared layout for the three primary tabs (Frei, Chat, Lernen).
//
// Provides the <main> wrapper that the globals.css safe-area handling
// expects (body > main → height: 100%, scroll inside). Inside main,
// the page content scrolls and the BottomNav sticks at the bottom of
// the safe area (the body padding already keeps both inside the
// non-system zone).
//
// Routes NOT under (tabs)/ — like /chat/[id], /vocab/practice,
// /vocab/sentence, /login, /privacy — get their own <main> from the
// page file and no bottom nav.

import BottomNav from "@/components/BottomNav";
import { MeProvider } from "@/components/MeProvider";

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="h-full flex flex-col bg-neutral-50">
      <div className="flex-1 overflow-y-auto">
        <MeProvider>{children}</MeProvider>
      </div>
      <BottomNav />
    </main>
  );
}
