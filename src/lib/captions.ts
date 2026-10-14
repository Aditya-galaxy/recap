import { remapSpan } from "./cuts";
import type { Range, Word } from "./types";

const ts = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(sec)}.${p(ms % 1000, 3)}`;
};

/**
 * Group words into caption cues. When `keep` is given, captions are built for the cleaned
 * cut: words that were cut are dropped and the rest are shifted onto the new timeline.
 */
export function toVtt(words: Word[], keep?: Range[]): string {
  const mapped: Word[] = [];
  for (const w of words) {
    if (!keep) {
      mapped.push(w);
      continue;
    }
    const r = remapSpan(w, keep);
    if (r) mapped.push({ ...w, ...r });
  }

  const cues: { start: number; end: number; text: string }[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    cues.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(" ") });
    cur = [];
  };
  for (const w of mapped) {
    const prev = cur[cur.length - 1];
    if (prev && (w.start - prev.end > 1 || cur.length >= 10)) flush();
    cur.push(w);
    if (/[.?!]$/.test(w.text) && cur.length >= 3) flush();
  }
  flush();

  return "WEBVTT\n\n" + cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(Math.max(c.end, c.start + 0.5))}\n${c.text}\n`).join("\n");
}
