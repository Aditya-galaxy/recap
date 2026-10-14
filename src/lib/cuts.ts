// Pure timeline math shared by the server (rendering) and the client (preview).
import type { CleanOptions, Range, Transcript, Word } from "./types";

const HESITATIONS = new Set(["um", "umm", "uh", "uhh", "uh-huh", "er", "erm", "ah", "hmm", "hm", "mm", "mhm"]);
const DISCOURSE = ["like", "basically", "you know", "i mean", "sort of", "kind of", "actually"];

/** Seconds of pause kept on each side of a shortened silence, so cuts don't feel abrupt. */
const SILENCE_PAD = 0.2;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z' -]/g, "").trim();

/** Tag filler words in place. Discourse fillers only count when comma-delimited ("like," not "I like it"). */
export function tagFillers(words: Word[]): Word[] {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const n = norm(w.text);
    if (HESITATIONS.has(n)) {
      w.filler = "hesitation";
      continue;
    }
    if (!/,\s*$/.test(w.text)) continue;
    // Look back up to one word for two-word phrases ("you know,").
    const pair = i > 0 ? norm(words[i - 1].text + " " + w.text) : "";
    if (pair && DISCOURSE.includes(pair) && !/[,.?!]\s*$/.test(words[i - 1].text)) {
      words[i - 1].filler = "discourse";
      w.filler = "discourse";
    } else if (DISCOURSE.includes(n)) {
      w.filler = "discourse";
    }
  }
  return words;
}

/**
 * Whisper smears word boundaries across pauses. Trim each word so it doesn't overlap a
 * detected silence, which fixes caption timing and keeps filler cuts tight.
 */
export function snapToSilences(words: Word[], silences: Range[]): Word[] {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    for (const s of silences) {
      if (s.end <= w.start || s.start >= w.end) continue;
      if (w.start >= s.start - 0.05 && w.end <= s.end + 0.05) {
        // Placed entirely inside a pause: it was really spoken right after it.
        const len = Math.min(w.end - w.start, 0.6);
        const next = words[i + 1]?.start ?? Infinity;
        w.start = s.end;
        w.end = Math.max(s.end + 0.1, Math.min(s.end + len, next));
      } else if (w.start >= s.start - 0.05) {
        w.start = s.end;
      } else if (w.end <= s.end + 0.05) {
        w.end = s.start;
      } else if (s.start - w.start >= w.end - s.end) {
        // A pause inside the word: keep whichever side is longer.
        w.end = s.start;
      } else {
        w.start = s.end;
      }
    }
  }
  return words.filter((w) => w.end > w.start);
}

function merge(ranges: Range[]): Range[] {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 0.05) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

export function cutRanges(t: Transcript, opts: CleanOptions, duration: number): Range[] {
  const cuts: Range[] = [];
  if (opts.silences) {
    for (const s of t.silences) {
      if (s.end - s.start < opts.minSilence) continue;
      const start = s.start === 0 ? 0 : s.start + SILENCE_PAD;
      const end = s.end >= duration - 0.05 ? duration : s.end - SILENCE_PAD;
      cuts.push({ start, end });
    }
  }
  if (opts.fillers) {
    t.words.forEach((w, i) => {
      if (w.filler === "hesitation" || (opts.aggressive && w.filler === "discourse")) {
        // Take the breath after the filler too, up to the next word.
        const next = t.words[i + 1]?.start ?? duration;
        cuts.push({ start: w.start, end: Math.max(w.end, Math.min(next, w.end + 0.3)) });
      }
    });
  }
  return merge(cuts).map((r) => ({ start: Math.max(0, r.start), end: Math.min(duration, r.end) }));
}

export function keepRanges(cuts: Range[], duration: number): Range[] {
  const keep: Range[] = [];
  let cursor = 0;
  for (const c of cuts) {
    if (c.start > cursor) keep.push({ start: cursor, end: c.start });
    cursor = Math.max(cursor, c.end);
  }
  if (cursor < duration) keep.push({ start: cursor, end: duration });
  return keep.filter((r) => r.end - r.start > 0.04);
}

/** Map a time on the original timeline onto the cleaned one; null if it falls inside a cut. */
export function remap(t: number, keep: Range[]): number | null {
  let acc = 0;
  for (const k of keep) {
    if (t < k.start) return null;
    if (t <= k.end) return acc + (t - k.start);
    acc += k.end - k.start;
  }
  return null;
}

/**
 * Map a word onto the cleaned timeline. A word survives if its midpoint is kept; its edges
 * are clamped to that kept span, since word boundaries rarely line up exactly with cuts.
 */
export function remapSpan(r: Range, keep: Range[]): Range | null {
  const mid = (r.start + r.end) / 2;
  let acc = 0;
  for (const k of keep) {
    if (mid >= k.start && mid <= k.end) {
      return { start: acc + Math.max(r.start, k.start) - k.start, end: acc + Math.min(r.end, k.end) - k.start };
    }
    acc += k.end - k.start;
  }
  return null;
}

export const total = (ranges: Range[]) => ranges.reduce((s, r) => s + (r.end - r.start), 0);
