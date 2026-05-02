"use client";

interface TopicGridProps {
  topics: string[];
  onSelect: (topic: string) => void;
  disabled?: boolean;
}

export default function TopicGrid({ topics, onSelect, disabled = false }: TopicGridProps) {
  const cells = Array.from({ length: 9 }, (_, i) => topics[i] ?? "");
  return (
    <div className="grid grid-cols-3 gap-3 w-full">
      {cells.map((topic, i) => (
        <button
          key={i}
          onClick={() => topic && onSelect(topic)}
          disabled={disabled || !topic}
          className="aspect-square rounded-xl border border-neutral-200 bg-white px-3 text-sm text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-center leading-snug"
        >
          {topic || <span className="text-neutral-300">…</span>}
        </button>
      ))}
    </div>
  );
}
