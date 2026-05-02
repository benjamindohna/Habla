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
              {/* grid-rows trick: smoothly animates from 0 to auto height; the
                  inner span uses overflow-hidden so the German fades up into
                  view rather than popping. The whole pair stays vertically
                  centered because the parent flex re-centers as height grows. */}
              <div className="grid grid-rows-[0fr] group-hover:grid-rows-[1fr] group-focus-visible:grid-rows-[1fr] transition-[grid-template-rows] duration-200 ease-out">
                <span className="overflow-hidden text-xs text-neutral-400 leading-tight pt-1">
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
