"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AiPolishBar } from "@/components/Guide";
import { fmtTime } from "@/lib/format";

type Step = { t: number; text: string; image: string; spoken?: string };
type Report = {
  status: "making" | "polishing" | "ready" | "error";
  error?: string;
  title: string;
  steps: Step[];
  expected: string;
  actual: string;
  actualImage?: string;
  actualT?: number;
  environment: string[];
  updatedAt: string;
  polished?: boolean;
  spoken?: { title: string; expected: string; actual: string };
  progress?: number;
};

/** The video's bug report, polled while it's being made or polished. */
function useReport(videoId: string) {
  const [report, setReport] = useState<Report | null | undefined>(undefined);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    const r = await fetch(`/api/videos/${videoId}/bug`, { cache: "no-store" });
    if (r.ok) setReport(((await r.json()) as { report: Report | null }).report);
  }, [videoId]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/videos/${videoId}/bug`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { report: Report | null } | null) => alive && j && setReport(j.report));
    return () => {
      alive = false;
    };
  }, [videoId]);
  useEffect(() => {
    if (report?.status !== "making" && report?.status !== "polishing") return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [report?.status, load]);
  async function make() {
    setErr("");
    const r = await fetch(`/api/videos/${videoId}/bug`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setErr(j.error ?? "Couldn't start the report.");
    setReport(j.report);
  }
  return { report, setReport, make, err };
}

const img = (videoId: string, name: string) => `/api/videos/${videoId}/bug?image=${encodeURIComponent(name)}`;

function markdown(r: Report) {
  const lines = [`## ${r.title}`, "", "**Steps to reproduce**", ...r.steps.map((s, i) => `${i + 1}. ${s.text || `Step ${i + 1}`}`)];
  lines.push("", "**Expected**", r.expected || "_(not stated)_", "", "**Actual**", r.actual || "_(not stated)_", "", "**Environment**", ...r.environment.map((e) => `- ${e}`));
  lines.push("", "_Report made with Recap from a screen recording._");
  return lines.join("\n") + "\n";
}

/** Side-panel tab: make the report, see its shape, open the editor. */
export function ReportPanel({ videoId, onSeek }: { videoId: string; onSeek: (t: number) => void }) {
  const { report, make, err } = useReport(videoId);
  if (report === undefined) return <p className="p-5 text-[13px] text-muted">loading…</p>;
  if (!report || report.status === "making" || (report.status === "error" && !report.steps.length)) {
    const making = report?.status === "making";
    return (
      <div className="space-y-4 overflow-y-auto p-5 text-[13px]">
        <p className="text-muted">
          Turns this recording into a bug report: steps to reproduce with screenshots, what should happen, what happened
          instead, and your setup. Copy it into GitHub, Linear or Jira. Made on this computer.
        </p>
        <p className="text-muted">Works best when you do the steps, then say what should happen and what happens instead.</p>
        {making && <div className="working-bar" />}
        <button className="btn-primary w-full" disabled={making} onClick={make}>
          {making ? "writing the report…" : "make a bug report"}
        </button>
        {(err || report?.status === "error") && (
          <p className="rounded-lg border border-border-strong p-3 text-[12px]"><span className="text-muted">error: </span>{err || report?.error}</p>
        )}
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-2 border-b border-border p-3">
        <Link className="btn-primary flex-1 text-center" href={`/v/${videoId}/bug`}>open report</Link>
        <button className="btn-ghost" disabled={report.status !== "ready"} onClick={make} title="Make it again from the recording (your edits are replaced)">remake</button>
      </div>
      <div className="space-y-3 overflow-y-auto p-4 text-[13px]">
        <p className="font-medium">{report.title}</p>
        <p className="text-muted">{report.steps.length} steps to reproduce</p>
        {report.actual && (
          <button className="block w-full rounded-lg border-l-2 border-[#e5484d] px-3 py-1 text-left hover:bg-accent-soft" onClick={() => report.actualT !== undefined && onSeek(report.actualT)}>
            <span className="text-muted">actual · {fmtTime(report.actualT ?? 0)}</span>
            <span className="line-clamp-3 block">{report.actual}</span>
          </button>
        )}
        {report.expected && (
          <div className="rounded-lg border-l-2 border-border-strong px-3 py-1">
            <span className="text-muted">expected</span>
            <span className="line-clamp-3 block">{report.expected}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Full-page editor with copy / GitHub issue / export. */
export function ReportEditor({ videoId, videoTitle }: { videoId: string; videoTitle: string }) {
  const { report, setReport, make, err } = useReport(videoId);
  const [saved, setSaved] = useState<"saved" | "saving" | "error">("saved");
  const [copied, setCopied] = useState(false);
  const [repo, setRepo] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      setRepo(localStorage.getItem("recap.githubRepo") ?? ""); // eslint-disable-line react-hooks/set-state-in-effect
    } catch {
      /* storage blocked: just ask each time */
    }
  }, []);

  function change(next: Report) {
    setReport(next);
    setSaved("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const r = await fetch(`/api/videos/${videoId}/bug`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next.title, steps: next.steps.map((s) => ({ image: s.image, text: s.text })), expected: next.expected, actual: next.actual, environment: next.environment }),
      });
      setSaved(r.ok ? "saved" : "error");
    }, 600);
  }

  if (report === undefined) return <p className="text-muted">loading…</p>;
  if (report?.status === "polishing") {
    const total = report.steps.length + 2;
    return (
      <div className="card mx-auto max-w-lg space-y-4 p-6 text-[14px]">
        <p>Polishing your report on this computer… {Math.min((report.progress ?? 0) + 1, total)} of {total}</p>
        <div className="working-bar" />
        <p className="text-[12px] text-muted">Nothing leaves your computer. You can undo it afterwards.</p>
      </div>
    );
  }
  if (!report || report.status !== "ready") {
    return (
      <div className="card mx-auto max-w-lg space-y-4 p-6 text-[14px]">
        <p>{report?.status === "making" ? "Writing the bug report from the recording…" : "This recording doesn't have a bug report yet."}</p>
        {report?.status === "making" ? <div className="working-bar" /> : <button className="btn-primary" onClick={make}>make a bug report</button>}
        {(err || report?.status === "error") && <p className="text-[12px] text-muted">error: {err || report?.error}</p>}
        <Link className="text-[13px] text-muted underline" href={`/v/${videoId}`}>back to the video</Link>
      </div>
    );
  }

  const r = report;
  const steps = r.steps;
  const setStep = (i: number, s: Partial<Step>) => change({ ...r, steps: steps.map((x, j) => (j === i ? { ...x, ...s } : x)) });
  const remove = (i: number) => change({ ...r, steps: steps.filter((_, j) => j !== i) });
  const md = markdown(r);
  const validRepo = /^[\w.-]+\/[\w.-]+$/.test(repo.trim());
  const issueUrl = validRepo
    ? `https://github.com/${repo.trim()}/issues/new?title=${encodeURIComponent(r.title)}&body=${encodeURIComponent(md.slice(0, 6000))}`
    : "";

  async function copy() {
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  function saveRepo(v: string) {
    setRepo(v);
    try {
      localStorage.setItem("recap.githubRepo", v.trim());
    } catch {
      /* not remembered: fine */
    }
  }
  const area = "w-full resize-y rounded-lg border border-transparent bg-transparent p-1.5 text-[16px] leading-relaxed outline-none hover:border-border focus:border-border-strong";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link className="text-[13px] text-muted hover:text-text" href={`/v/${videoId}`}>← {videoTitle}</Link>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-muted">{saved === "saving" ? "saving…" : saved === "error" ? "couldn't save" : "saved"}</span>
          <button className="btn-ghost" onClick={copy}>{copied ? "copied ✓" : "copy as Markdown"}</button>
          <a className="btn-primary" href={`/api/videos/${videoId}/bug?format=html`} title="One file with the screenshots inside: attach it, open it in a browser, or print it to PDF.">export</a>
        </div>
      </div>

      <input className="mb-1 w-full bg-transparent text-3xl font-semibold tracking-tight outline-none" value={r.title} onChange={(e) => change({ ...r, title: e.target.value })} aria-label="Report title" />
      <p className="mb-4 text-[13px] text-muted">bug report · edit anything, it saves as you type</p>
      <AiPolishBar
        what="report"
        polishUrl={`/api/videos/${videoId}/bug/polish`}
        polished={!!r.polished}
        error={r.error}
        onStarted={(j) => setReport((j as { report: Report }).report)}
        onUndo={async () => {
          const res = await fetch(`/api/videos/${videoId}/bug`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: r.spoken?.title ?? r.title,
              expected: r.spoken?.expected ?? r.expected,
              actual: r.spoken?.actual ?? r.actual,
              steps: r.steps.map((s) => ({ image: s.image, text: s.spoken ?? s.text })),
              polished: false,
            }),
          });
          if (res.ok) setReport((await res.json()).report);
        }}
      />

      <h2 className="label mb-3 mt-8">steps to reproduce</h2>
      {!steps.length && <p className="text-[14px] text-muted">No steps were said before the problem. Add them to the recording, or describe them in the issue.</p>}
      <ol className="space-y-8">
        {steps.map((s, i) => (
          <li key={s.image} className="group">
            <div className="mb-3 flex items-start gap-3">
              <span className="mt-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-[13px] font-semibold text-accent-text">{i + 1}</span>
              <textarea className={`${area} min-h-[2.6em] flex-1`} rows={Math.max(1, Math.ceil(s.text.length / 70))} value={s.text} placeholder="Describe this step" onChange={(e) => setStep(i, { text: e.target.value })} aria-label={`Step ${i + 1}`} />
              <button className="btn-ghost shrink-0 px-2 opacity-60 group-hover:opacity-100" onClick={() => remove(i)} aria-label="Remove step">remove</button>
            </div>
            <Link href={`/v/${videoId}?t=${s.t}`} title={`Watch this moment (${fmtTime(s.t)})`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img(videoId, s.image)} alt={`Step ${i + 1}`} className="w-full rounded-xl border border-border" />
            </Link>
          </li>
        ))}
      </ol>

      <h2 className="label mb-2 mt-10">expected</h2>
      <textarea className={`${area} border-l-2 border-l-border-strong`} rows={2} value={r.expected} placeholder="What should have happened" onChange={(e) => change({ ...r, expected: e.target.value })} aria-label="Expected" />

      <h2 className="label mb-2 mt-8">actual</h2>
      <textarea className={`${area} border-l-2 border-l-[#e5484d]`} rows={2} value={r.actual} placeholder="What happened instead" onChange={(e) => change({ ...r, actual: e.target.value })} aria-label="Actual" />
      {r.actualImage && (
        <Link href={`/v/${videoId}?t=${r.actualT ?? 0}`} title="Watch this moment" className="mt-3 block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img(videoId, r.actualImage)} alt="What happened" className="w-full rounded-xl border border-border" />
        </Link>
      )}

      <h2 className="label mb-2 mt-8">environment</h2>
      <textarea className={area} rows={Math.max(2, r.environment.length)} value={r.environment.join("\n")} onChange={(e) => change({ ...r, environment: e.target.value.split("\n") })} aria-label="Environment" placeholder="App version, browser, account…" />

      <div className="card mt-10 space-y-3 p-5 text-[13px]">
        <p className="font-medium">File it</p>
        <div className="flex flex-wrap items-center gap-2">
          <input className="w-56 rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-border-strong" placeholder="owner/repo" value={repo} onChange={(e) => saveRepo(e.target.value)} aria-label="GitHub repository" />
          <a className={`btn-primary ${validRepo ? "" : "pointer-events-none opacity-40"}`} href={issueUrl || undefined} aria-disabled={!validRepo || undefined} target="_blank" rel="noreferrer">open GitHub issue</a>
          <a className="btn-ghost" href={`/api/videos/${videoId}/media?download`}>export recording</a>
        </div>
        <p className="text-muted">
          The issue opens filled in. Drag the exported recording or report file into it to attach screenshots. For Linear or
          Jira, use <span className="text-text">copy as Markdown</span> and paste.
        </p>
      </div>
    </div>
  );
}
