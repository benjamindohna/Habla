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
          className="group aspect-square rounded-xl border border-neutral-200 bg-white px-3 py-2 transition-colors hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center justify-center text-center"
        >
          {topic ? (
            <>
              <span className="text-sm text-neutral-800 leading-snug">{topic.es}</span>
              {/* Wrapper snaps from h-0 to h-auto on hover (no slide reveal);
                  the inner span fades in with an opacity transition. Result:
                  Spanish re-centers instantly, German just blends in. */}
              <div className="h-0 group-hover:h-auto group-focus-visible:h-auto overflow-hidden">
                <span className="block pt-1 text-xs text-neutral-400 leading-tight opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-200 ease-out">
                  {topic.native}
                </span>
              </div>
            </>
          ) : (
            <span className="text-neutral-300">…</span>
          )}
        </button>
      ))}
    </div>
  );
}
