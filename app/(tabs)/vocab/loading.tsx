// Loading state for the Lernen tab. The vocab menu is server-rendered
// (auth + getUserById + label resolution), which can take a few hundred
// ms over the network. Without this, the tap on "Lernen" would feel
// unresponsive — Next.js renders this Suspense fallback during the
// server roundtrip and swaps in the real page when ready.

export default function VocabMenuLoading() {
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <span className="w-6 h-6 rounded-full border-2 border-neutral-200 border-t-neutral-600 animate-spin" />
    </div>
  );
}
