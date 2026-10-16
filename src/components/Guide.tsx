"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { fmtTime } from "@/lib/format";

type Step = { t: number; text: string; image: string; spoken?: string };
type Guide = {
  status: "making" | "polishing" | "ready" | "error";
  error?: string;
  title: string;
  steps: Step[];
  updatedAt: string;
  polished?: boolean;
  spokenTitle?: string;
  progress?: number;
};
type Ai = { available: boolean; model: "none" | "downloading" | "ready" | "error"; progress: number; error?: string; bytes: number };

/** The video's guide, polled while it's being made. */
function useGuide(videoId: string) {
  const [guide, setGuide] = useState<Guide | null | undefined>(undefined);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    const r = await fetch(`/api/videos/${videoId}/guide`, { cache: "no-store" });
    if (r.ok) setGuide(((await r.json()) as { guide: Guide | null }).guide);
  }, [videoId]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/videos/${videoId}/guide`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { guide: Guide | null } | null) => alive && j && setGuide(j.guide));
    return () => {
      alive = false;
    };
  }, [videoId]);
  useEffect(() => {
    if (guide?.status !== "making" && guide?.status !== "polishing") return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [guide?.status, load]);
  async function make() {
    setErr("");
    const r = await fetch(`/api/videos/${videoId}/guide`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setErr(j.error ?? "Couldn't start the guide.");
    setGuide(j.guide);
  }
  return { guide, setGuide, make, err };
}

const img = (videoId: string, name: string) => `/api/videos/${videoId}/guide?image=${encodeURIComponent(name)}`;

/** Side-panel tab on the video page: make the guide, skim its steps, open the editor. */
export function GuidePanel({ videoId, onSeek }: { videoId: string; onSeek: (t: number) => void }) {
  const { guide, make, err } = useGuide(videoId);
  if (guide === undefined) return <p className="p-5 text-[13px] text-muted">loading…</p>;

  if (!guide || (guide.status !== "ready" && !guide.steps.length)) {
    const making = guide?.status === "making";
    return (
      <div className="space-y-4 overflow-y-auto p-5 text-[13px]">
        <p className="text-muted">
          Turns this recording into a written step-by-step guide: what you said becomes the steps, with a screenshot of
          each one. Edit it, then export it to Notion, Google Docs, Confluence or PDF. Made on this computer.
        </p>
        <p className="text-muted">Works best when you say each step out loud as you do it.</p>
        {making && <div className="working-bar" />}
        <button className="btn-primary w-full" disabled={making} onClick={make}>
          {making ? "making your guide…" : "make a step-by-step guide"}
        </button>
        {(err || guide?.status === "error") && (
          <p className="rounded-lg border border-border-strong p-3 text-[12px]"><span className="text-muted">error: </span>{err || guide?.error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-2 border-b border-border p-3">
        <Link className="btn-primary flex-1 text-center" href={`/v/${videoId}/guide`}>open guide</Link>
        <button className="btn-ghost" disabled={guide.status === "making" || guide.status === "polishing"} onClick={make} title="Make it again from the recording (your edits are replaced)">
          {guide.status === "making" ? "remaking…" : "remake"}
        </button>
      </div>
      <ol className="space-y-3 overflow-y-auto p-4 text-[13px]">
        {guide.steps.map((s, i) => (
          <li key={s.image}>
            <button className="flex w-full gap-3 rounded-lg p-1.5 text-left hover:bg-accent-soft" onClick={() => onSeek(s.t)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img(videoId, s.image)} alt="" className="h-12 w-20 shrink-0 rounded border border-border object-cover" />
              <span className="min-w-0">
                <span className="text-muted">{i + 1} · {fmtTime(s.t)}</span>
                <span className="line-clamp-2 block">{s.text || <span className="text-muted">no words, add some in the editor</span>}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Full-page editor: edit the title and each step, reorder or remove steps, export. */
export function GuideEditor({ videoId, videoTitle }: { videoId: string; videoTitle: string }) {
  const { guide, setGuide, make, err } = useGuide(videoId);
  const [saved, setSaved] = useState<"saved" | "saving" | "error">("saved");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Autosave shortly after each edit.
  function change(next: Guide) {
    setGuide(next);
    setSaved("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const r = await fetch(`/api/videos/${videoId}/guide`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next.title, steps: next.steps.map((s) => ({ image: s.image, text: s.text })) }),
      });
      setSaved(r.ok ? "saved" : "error");
    }, 600);
  }

  if (guide === undefined) return <p className="text-muted">loading…</p>;
  if (guide?.status === "polishing") {
    return (
      <div className="card mx-auto max-w-lg space-y-4 p-6 text-[14px]">
        <p>Polishing your guide on this computer… step {Math.min((guide.progress ?? 0) + 1, guide.steps.length)} of {guide.steps.length}</p>
        <div className="working-bar" />
        <p className="text-[12px] text-muted">Nothing leaves your computer. You can undo it afterwards.</p>
      </div>
    );
  }
  if (!guide || guide.status !== "ready") {
    return (
      <div className="card mx-auto max-w-lg space-y-4 p-6 text-[14px]">
        <p>{guide?.status === "making" ? "Making your guide from the recording…" : "This recording doesn't have a guide yet."}</p>
        {guide?.status === "making" ? <div className="working-bar" /> : <button className="btn-primary" onClick={make}>make a step-by-step guide</button>}
        {(err || guide?.status === "error") && <p className="text-[12px] text-muted">error: {err || guide?.error}</p>}
        <Link className="text-[13px] text-muted underline" href={`/v/${videoId}`}>back to the video</Link>
      </div>
    );
  }

  const steps = guide.steps;
  const setStep = (i: number, s: Partial<Step>) => change({ ...guide, steps: steps.map((x, j) => (j === i ? { ...x, ...s } : x)) });
  const move = (i: number, d: -1 | 1) => {
    const next = [...steps];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    change({ ...guide, steps: next });
  };
  const remove = (i: number) => change({ ...guide, steps: steps.filter((_, j) => j !== i) });

  async function copyText() {
    const md = `# ${guide!.title}\n\n${steps.map((s, i) => `${i + 1}. ${s.text || `Step ${i + 1}`}`).join("\n")}\n`;
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link className="text-[13px] text-muted hover:text-text" href={`/v/${videoId}`}>← {videoTitle}</Link>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-muted">{saved === "saving" ? "saving…" : saved === "error" ? "couldn't save" : "saved"}</span>
          <button className="btn-ghost" onClick={copyText}>{copied ? "copied ✓" : "copy text"}</button>
          <a className="btn-primary" href={`/api/videos/${videoId}/guide?format=html`} title="One file with the screenshots inside. Opens in any browser; import it into Notion, Google Docs or Confluence, or print it to PDF.">
            export
          </a>
        </div>
      </div>

      <input
        className="mb-1 w-full bg-transparent text-3xl font-semibold tracking-tight outline-none"
        value={guide.title}
        onChange={(e) => change({ ...guide, title: e.target.value })}
        aria-label="Guide title"
      />
      <p className="mb-4 text-[13px] text-muted">{steps.length} steps · edit anything, it saves as you type</p>
      <AiPolish videoId={videoId} guide={guide} setGuide={setGuide} />

      <ol className="space-y-10">
        {steps.map((s, i) => (
          <li key={s.image} className="group">
            <div className="mb-3 flex items-start gap-3">
              <span className="mt-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-[13px] font-semibold text-accent-text">{i + 1}</span>
              <textarea
                className="min-h-[2.6em] flex-1 resize-y rounded-lg border border-transparent bg-transparent p-1.5 text-[16px] leading-relaxed outline-none hover:border-border focus:border-border-strong"
                rows={Math.max(1, Math.ceil(s.text.length / 70))}
                value={s.text}
                placeholder="Describe this step"
                onChange={(e) => setStep(i, { text: e.target.value })}
                aria-label={`Step ${i + 1}`}
              />
              <div className="flex shrink-0 gap-1 opacity-60 group-hover:opacity-100">
                <button className="btn-ghost px-2" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                <button className="btn-ghost px-2" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                <button className="btn-ghost px-2" onClick={() => remove(i)} aria-label="Remove step">remove</button>
              </div>
            </div>
            <Link href={`/v/${videoId}?t=${s.t}`} title={`Watch this moment (${fmtTime(s.t)})`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img(videoId, s.image)} alt={`Step ${i + 1}`} className="w-full rounded-xl border border-border" />
            </Link>
          </li>
        ))}
      </ol>
      {!steps.length && <p className="text-muted">All steps removed. Remake the guide from the video page to start over.</p>}
    </div>
  );
}

/** Guide-specific wiring for the shared AI polish bar. */
function AiPolish({ videoId, guide, setGuide }: { videoId: string; guide: Guide; setGuide: (g: Guide) => void }) {
  return (
    <AiPolishBar
      polishUrl={`/api/videos/${videoId}/guide/polish`}
      polished={!!guide.polished}
      error={guide.error}
      onStarted={(j) => setGuide((j as { guide: Guide }).guide)}
      onUndo={async () => {
        const r = await fetch(`/api/videos/${videoId}/guide`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: guide.spokenTitle ?? guide.title, steps: guide.steps.map((s) => ({ image: s.image, text: s.spoken ?? s.text })), polished: false }),
        });
        if (r.ok) setGuide((await r.json()).guide);
      }}
    />
  );
}

/** Optional on-device AI: rewrites spoken text as clean writing. Hidden where it isn't bundled. */
export function AiPolishBar({ polishUrl, polished, error, onStarted, onUndo, what = "steps" }: {
  polishUrl: string;
  polished: boolean;
  error?: string;
  onStarted: (json: unknown) => void;
  onUndo: () => void;
  what?: string;
}) {
  const [ai, setAi] = useState<Ai | null>(null);
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState("");
  const pending = useRef(false);

  // The parent passes a fresh callback each render; keep the latest in a ref so the status effect stays put.
  const started = useRef(onStarted);
  useEffect(() => {
    started.current = onStarted;
  }, [onStarted]);
  const polish = useCallback(async () => {
    setErr("");
    const r = await fetch(polishUrl, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setErr(j.error ?? "Couldn't start.");
    started.current(j);
  }, [polishUrl]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const r = await fetch("/api/ai", { cache: "no-store" }).catch(() => null);
      if (!alive || !r?.ok) return;
      const a: Ai = await r.json();
      setAi(a);
      if (a.model === "ready" && pending.current) {
        pending.current = false;
        polish();
      }
    };
    tick();
    const t = setInterval(() => ai?.model === "downloading" && tick(), 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [ai?.model, polish]);

  if (!ai?.available) return null;

  async function download() {
    setAsking(false);
    pending.current = true;
    const r = await fetch("/api/ai", { method: "POST" });
    if (r.ok) setAi(await r.json());
  }

  const gb = (ai.bytes / 1e9).toFixed(1);
  const message = err || error || (ai.model === "error" ? ai.error : "");
  return (
    <div className="mb-8 rounded-xl border border-border p-4 text-[13px]">
      {polished ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted">✦ Polished by on-device AI. Check each step before you share it.</span>
          <button className="btn-ghost" onClick={onUndo}>undo polish</button>
        </div>
      ) : ai.model === "downloading" ? (
        <div className="space-y-2">
          <p className="text-muted">Downloading the AI model, once… {Math.round(ai.progress * 100)}%</p>
          <div className="h-1.5 overflow-hidden rounded bg-border"><div className="h-full bg-accent" style={{ width: `${ai.progress * 100}%` }} /></div>
        </div>
      ) : asking ? (
        <div className="space-y-3">
          <p>Polish rewrites what you said as short, clear writing. It runs entirely on this computer and needs a one-time {gb} GB download.</p>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={download}>download and polish</button>
            <button className="btn-ghost" onClick={() => setAsking(false)}>not now</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted">Turn spoken {what} into clean writing. Runs on this computer.</span>
          <button className="btn-primary" onClick={() => (ai.model === "ready" ? polish() : setAsking(true))}>✦ polish with on-device AI</button>
        </div>
      )}
      {message && <p className="mt-2 text-[12px] text-muted">{message}</p>}
    </div>
  );
}
