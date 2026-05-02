"use client";

export interface Topic {
  es: string;
  native: string;
}

interface TopicGridProps {
  topics: Topic[];
  onSelect: (topic: Topic) => void;
  disabled?: boolean;
}

export default function TopicGrid({ topics, onSelect, disabled = false }: TopicGridProps) {
  const cells: (Topic | null)[] = Array.from({ length: 9 }, (_, i) => topics[i] ?? null);
  return (
    <div className="grid grid-cols-3 gap-3 w-full">
      {cells.map((topic, i) => (
        <button
          key={i}
          onClick={() => topic && onSelect(topic)}
          disabled={disabled || !topic}
          className="aspect-square rounded-xl border border-neutral-200 bg-white px-3 py-2 transition-colors hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center justify-center text-center gap-1"
        >
          {topic ? (
            <>
              <span className="text-sm text-neutral-800 leading-snug">{topic.es}</span>
              <span className="text-xs text-neutral-400 leading-tight">{topic.native}</span>
            </>
          ) : (
            <span className="text-neutral-300">…</span>
          )}
        </button>
      ))}
    </div>
  );
}
