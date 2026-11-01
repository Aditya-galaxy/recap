"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { fmtTime } from "@/lib/format";
import type { Range } from "@/lib/types";

/** The shortest video you can trim down to, in seconds. */
const MIN_KEEP = 1;

/**
 * The video as one bar: drag the two handles to trim the ends, click anywhere to seek. Gaps in the kept
 * part show what clean up would remove. All times are on the original timeline.
 */
export default function TrimBar({
  duration,
  start,
  end,
  cuts,
  now,
  onSeek,
  onTrim,
}: {
  duration: number;
  start: number;
  end: number;
  cuts: Range[];
  now: number;
  onSeek: (t: number) => void;
  onTrim: (start: number, end: number, moved: number) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const pct = (t: number) => `${(t / duration) * 100}%`;
  const timeAt = (x: number) => {
    const b = rail.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (x - b.left) / b.width)) * duration;
  };
  const moveStart = (t: number) => {
    const s = Math.max(0, Math.min(t, end - MIN_KEEP));
    onTrim(s, end, s);
  };
  const moveEnd = (t: number) => {
    const e = Math.min(duration, Math.max(t, start + MIN_KEEP));
    onTrim(start, e, e);
  };

  function handle(label: string, at: number, move: (t: number) => void, min: number, max: number) {
    return (
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={Math.floor(min)}
        aria-valuemax={Math.ceil(max)}
        aria-valuenow={Math.round(at)}
        aria-valuetext={fmtTime(at)}
        title={`${label}: ${fmtTime(at)}`}
        onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && move(timeAt(e.clientX))}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          move(at + (e.key === "ArrowLeft" ? -0.5 : 0.5));
        }}
        className="group absolute -inset-y-1 z-10 flex w-4 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center outline-none"
        style={{ left: pct(at) }}
      >
        <span className="h-full w-[5px] rounded-full bg-accent transition group-hover:w-[7px] group-focus-visible:w-[7px]" />
      </div>
    );
  }

  return (
    <div
      ref={rail}
      data-trim-bar
      onPointerDown={(e) => onSeek(timeAt(e.clientX))}
      className="relative h-10 cursor-pointer touch-none select-none rounded-lg bg-surface-2"
    >
      <div className="absolute inset-y-0 bg-muted/40" style={{ left: pct(start), right: `calc(100% - ${pct(end)})` }} />
      {cuts.map((c) => {
        const from = Math.max(c.start, start);
        const to = Math.min(c.end, end);
        return to > from ? <div key={c.start} className="absolute inset-y-0 bg-surface-2" style={{ left: pct(from), width: pct(to - from) }} /> : null;
      })}
      <div className="pointer-events-none absolute inset-y-0 w-px bg-text" style={{ left: pct(now) }} />
      {handle("Trim start", start, moveStart, 0, end - MIN_KEEP)}
      {handle("Trim end", end, moveEnd, start + MIN_KEEP, duration)}
    </div>
  );
}
