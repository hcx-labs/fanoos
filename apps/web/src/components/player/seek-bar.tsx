import { useRef, useState } from "react";
import { formatDuration } from "@/lib/format";
import { segmentMeta } from "@/lib/segments";
import type { Chapter, Segment } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  duration: number;
  current: number;
  buffered: number;
  chapters: Chapter[];
  segments: Segment[];
  onSeek: (time: number) => void;
  onScrub?: (scrubbing: boolean) => void;
};

/** Chapter-segmented scrubber with SponsorBlock overlays and a hover preview. */
export function SeekBar({ duration, current, buffered, chapters, segments, onSeek, onScrub }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const total = duration || 1;
  const shown = drag ?? current;
  const parts = (chapters.length ? chapters : [{ start: 0, title: "" }]).map((chapter, i, all) => ({
    ...chapter,
    end: all[i + 1]?.start ?? total,
  }));

  const timeAt = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * total;
  };

  const preview = hover ?? drag;
  const previewChapter = preview === null ? undefined : parts.find((p) => preview >= p.start && preview < p.end);
  const previewSegment = preview === null ? undefined : segments.find((s) => preview >= s.start && preview < s.end);
  const percent = (t: number) => `${(t / total) * 100}%`;

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(total)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={`${formatDuration(shown)} of ${formatDuration(total)}`}
      className="group/seek relative flex h-5 cursor-pointer touch-none items-center outline-none"
      onPointerMove={(e) => {
        const t = timeAt(e.clientX);
        setHover(t);
        if (drag !== null) setDrag(t);
      }}
      onPointerLeave={() => setHover(null)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(timeAt(e.clientX));
        onScrub?.(true);
      }}
      onPointerUp={(e) => {
        if (drag === null) return;
        onSeek(timeAt(e.clientX));
        setDrag(null);
        onScrub?.(false);
      }}
      onKeyDown={(e) => {
        const step = { ArrowLeft: -5, ArrowRight: 5, PageDown: -30, PageUp: 30 }[e.key];
        if (step !== undefined) {
          e.preventDefault();
          e.stopPropagation();
          onSeek(Math.min(total, Math.max(0, current + step)));
        } else if (e.key === "Home" || e.key === "End") {
          e.preventDefault();
          onSeek(e.key === "Home" ? 0 : total);
        }
      }}
    >
      <div className="flex h-2.5 w-full items-center gap-[3px]">
        {parts.map((part) => {
          const width = ((part.end - part.start) / total) * 100;
          const fill = (t: number) => Math.min(1, Math.max(0, (t - part.start) / (part.end - part.start))) * 100;
          const active = previewChapter === part;
          return (
            <div
              key={part.start}
              className={cn(
                "relative h-1 overflow-hidden rounded-full bg-white/25 transition-[height] duration-150 group-hover/seek:h-1.5 group-focus-visible/seek:h-1.5",
                active && "group-hover/seek:h-2.5",
              )}
              style={{ width: `${width}%` }}
            >
              <div className="absolute inset-y-0 left-0 bg-white/35" style={{ width: `${fill(buffered)}%` }} />
              <div className="bg-brand absolute inset-y-0 left-0" style={{ width: `${fill(shown)}%` }} />
              {preview !== null && <div className="absolute inset-y-0 left-0 bg-white/25" style={{ width: `${fill(preview)}%` }} />}
              {/* Segments live inside each chapter so they share its height, rounding and gaps. The
                  part already played is full colour and the rest dimmed, so progress stays visible
                  inside a segment. */}
              {segments
                .filter((seg) => seg.end > part.start && seg.start < part.end)
                .map((seg, i) => {
                  const [from, to, played] = [fill(seg.start), fill(seg.end), fill(Math.min(Math.max(shown, seg.start), seg.end))];
                  const color = segmentMeta[seg.category].color;
                  return (
                    <div key={i}>
                      {played > from && <div className="absolute inset-y-0" style={{ left: `${from}%`, width: `${played - from}%`, background: color }} />}
                      {to > played && <div className="absolute inset-y-0 opacity-45" style={{ left: `${played}%`, width: `${to - played}%`, background: color }} />}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
      <div
        className={cn(
          "bg-brand pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full shadow-md ring-2 ring-white transition-[scale] group-hover/seek:scale-100 group-focus-visible/seek:scale-100 group-focus-visible/seek:ring-4",
          drag !== null && "scale-115 group-hover/seek:scale-115",
        )}
        style={{ left: percent(shown) }}
      />

      {preview !== null && (
        <div
          className="pointer-events-none absolute bottom-6 flex -translate-x-1/2 flex-col items-center gap-1"
          style={{ left: `clamp(4rem, ${percent(preview)}, calc(100% - 4rem))` }}
        >
          {previewSegment && (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-black" style={{ background: segmentMeta[previewSegment.category].color }}>
              {segmentMeta[previewSegment.category].label}
            </span>
          )}
          <span className="rounded-lg bg-black/85 px-2.5 py-1 text-center text-xs whitespace-nowrap text-white shadow-lg backdrop-blur">
            {previewChapter?.title && <span className="block max-w-48 truncate font-medium">{previewChapter.title}</span>}
            <span className="text-white/75 tabular-nums">{formatDuration(preview)}</span>
          </span>
        </div>
      )}
    </div>
  );
}
