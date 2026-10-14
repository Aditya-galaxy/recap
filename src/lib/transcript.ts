import type { Range, Transcript, Word } from "./types";

// Transcripts uploaded by the desktop app are untrusted input: keep only well-formed words and ranges.

const MAX_WORDS = 200_000; // ~20 hours of speech
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

function range(r: unknown): Range | null {
  if (!r || typeof r !== "object") return null;
  const start = num((r as Range).start);
  const end = num((r as Range).end);
  return start !== null && end !== null && end >= start ? { start, end } : null;
}

export function sanitizeTranscript(raw: unknown): Transcript | null {
  if (!raw || typeof raw !== "object") return null;
  const { words, silences } = raw as { words?: unknown; silences?: unknown };
  if (!Array.isArray(words) || words.length > MAX_WORDS) return null;
  const outWords: Word[] = [];
  for (const w of words) {
    const r = range(w);
    const text = typeof (w as Word)?.text === "string" ? (w as Word).text.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 100) : "";
    if (!r || !text.trim()) continue;
    const filler = (w as Word).filler;
    outWords.push({ ...r, text, ...(filler === "hesitation" || filler === "discourse" ? { filler } : {}) });
  }
  const outSilences = Array.isArray(silences) ? silences.slice(0, MAX_WORDS).map(range).filter((r): r is Range => !!r) : [];
  return { words: outWords, silences: outSilences };
}
