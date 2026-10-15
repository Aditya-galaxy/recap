"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fmtTime } from "@/lib/format";

const REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "🤔"];

export interface Viewer {
  id: string;
  verified: boolean;
}

interface Comment {
  id: string;
  author: string;
  authorId: string;
  t: number | null;
  body: string;
  createdAt: string;
}

/** Emoji reactions, pinned to the current moment of the video. No account needed. */
export function ReactionsBar({ videoId, now, duration }: { videoId: string; now: number; duration: number }) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [marks, setMarks] = useState<{ emoji: string; t: number }[]>([]);
  const [flash, setFlash] = useState("");

  useEffect(() => {
    fetch(`/api/videos/${videoId}/reactions`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && (setCounts(d.counts), setMarks(d.marks)))
      .catch(() => {});
  }, [videoId]);

  async function react(emoji: string) {
    setFlash(emoji);
    setTimeout(() => setFlash(""), 600);
    const r = await fetch(`/api/videos/${videoId}/reactions`, { method: "POST", body: JSON.stringify({ emoji, t: now }) });
    if (r.ok) {
      const d = await r.json();
      setCounts(d.counts);
      setMarks(d.marks);
    }
  }

  return (
    <div className="space-y-2">
      {duration > 0 && marks.length > 0 && (
        <div className="relative h-4" aria-label="Reactions on the timeline">
          {marks.map((m, i) => (
            <span key={i} className="absolute -translate-x-1/2 text-[11px]" style={{ left: `${Math.min(100, (m.t / duration) * 100)}%` }} title={fmtTime(m.t)}>
              {m.emoji}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {REACTIONS.map((e) => (
          <button
            key={e}
            onClick={() => react(e)}
            className={`rounded-lg border border-border px-2 py-1 text-[13px] transition hover:border-border-strong ${flash === e ? "scale-110" : ""}`}
            title={`React at ${fmtTime(now)}`}
          >
            {e} {counts[e] ? <span className="text-[11px] text-muted">{counts[e]}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Timestamped comments. Reading is open to anyone who can watch; writing needs a confirmed account. */
export function CommentsPanel({
  videoId,
  viewer,
  owner,
  now,
  onSeek,
  loginHref,
}: {
  videoId: string;
  viewer: Viewer | null;
  owner: boolean;
  now: number;
  onSeek: (t: number) => void;
  loginHref: string;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState("");
  const [atTime, setAtTime] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/videos/${videoId}/comments`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setComments)
      .catch(() => {});
  }, [videoId]);
  useEffect(load, [load]);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await fetch(`/api/videos/${videoId}/comments`, { method: "POST", body: JSON.stringify({ body, t: atTime ? now : null }) });
    setBusy(false);
    if (!r.ok) return setError((await r.json().catch(() => ({}))).error ?? "Couldn't post.");
    setBody("");
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/videos/${videoId}/comments/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-5 text-[13px]">
        {comments.length === 0 && <p className="text-muted">No comments yet.</p>}
        {comments.map((c) => (
          <div key={c.id}>
            <div className="flex items-baseline justify-between gap-2 text-[11px] text-muted">
              <span>
                <span className="text-text">{c.author}</span>
                {c.t !== null && (
                  <button className="ml-2 underline" onClick={() => onSeek(c.t!)}>
                    {fmtTime(c.t)}
                  </button>
                )}
              </span>
              {(owner || viewer?.id === c.authorId) && (
                <button className="hover:text-text" onClick={() => remove(c.id)} aria-label="Delete comment">
                  delete
                </button>
              )}
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words">{c.body}</p>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-3">
        {!viewer ? (
          <p className="text-[12px] text-muted">
            <Link href={loginHref} className="text-text underline">Sign in</Link> to comment.
          </p>
        ) : !viewer.verified ? (
          <p className="text-[12px] text-muted">Confirm your email to comment.</p>
        ) : (
          <form onSubmit={post} className="space-y-2">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="add a comment…"
              className="w-full resize-none rounded-lg border border-border bg-surface px-2.5 py-2 text-[13px] outline-none focus:border-border-strong"
            />
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <label className="flex items-center gap-1.5 text-muted">
                <input type="checkbox" checked={atTime} onChange={(e) => setAtTime(e.target.checked)} /> at {fmtTime(now)}
              </label>
              <button className="btn-primary" disabled={busy || !body.trim()}>{busy ? "…" : "post"}</button>
            </div>
            {error && <p className="text-[11px] text-muted">{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}

interface Insights {
  uniqueViewers: number;
  avgCompletion: number;
  funnel: { started: number; quarter: number; half: number; threeQuarters: number; finished: number };
  viewers: { who: string; progress: number; lastAt: string }[];
}

/** Owner-only: who watched and how far. */
export function InsightsPanel({ videoId }: { videoId: string }) {
  const [data, setData] = useState<Insights | null>(null);
  useEffect(() => {
    fetch(`/api/videos/${videoId}/insights`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {});
  }, [videoId]);
  if (!data) return <p className="p-5 text-[13px] text-muted">loading…</p>;
  if (!data.uniqueViewers) return <p className="p-5 text-[13px] text-muted">No views yet. Share the link and you&apos;ll see who watched and how far.</p>;
  const pct = (n: number) => `${Math.round((n / data.funnel.started) * 100)}%`;
  return (
    <div className="space-y-5 overflow-y-auto p-5 text-[13px]">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border p-3">
          <p className="label">viewers</p>
          <p className="mt-1 text-xl font-light">{data.uniqueViewers}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="label">avg watched</p>
          <p className="mt-1 text-xl font-light">{Math.round(data.avgCompletion * 100)}%</p>
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="label">how far people got</p>
        {([
          ["started", data.funnel.started],
          ["25%", data.funnel.quarter],
          ["50%", data.funnel.half],
          ["75%", data.funnel.threeQuarters],
          ["finished", data.funnel.finished],
        ] as const).map(([label, n]) => (
          <div key={label} className="flex items-center gap-2 text-[12px]">
            <span className="w-16 text-muted">{label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full bg-accent" style={{ width: pct(n) }} />
            </div>
            <span className="w-10 text-right tabular-nums">{n}</span>
          </div>
        ))}
      </div>
      <div className="space-y-1.5">
        <p className="label">recent viewers</p>
        {data.viewers.map((v, i) => (
          <div key={i} className="flex justify-between text-[12px]">
            <span className={v.who === "anonymous viewer" ? "text-muted" : ""}>{v.who}</span>
            <span className="text-muted">{Math.round(v.progress * 100)}% · {new Date(v.lastAt).toLocaleDateString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const REPORT_REASONS = ["spam or scam", "harassment or hate", "sexual content", "violence", "copyright", "other"];

/** Lets any viewer flag a shared video for the server's admins. */
export function ReportButton({ videoId }: { videoId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    setError("");
    const r = await fetch(`/api/videos/${videoId}/report`, { method: "POST", body: JSON.stringify({ reason, details }) });
    if (r.ok) return setState("done");
    setState("idle");
    setError((await r.json().catch(() => ({}))).error ?? "Couldn't send the report.");
  }

  if (!open)
    return (
      <button className="text-[11px] text-muted underline hover:text-text" onClick={() => setOpen(true)}>
        report
      </button>
    );
  return (
    <div className="card w-full max-w-sm space-y-2 p-3 text-[12px]">
      {state === "done" ? (
        <p>Thanks. An admin will review it.</p>
      ) : (
        <form onSubmit={send} className="space-y-2">
          <p className="label">report this video</p>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 outline-none focus:border-border-strong"
          >
            <option value="" disabled>
              why?
            </option>
            {REPORT_REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="details (optional)"
            className="w-full resize-none rounded-lg border border-border bg-surface px-2 py-1.5 outline-none focus:border-border-strong"
          />
          {error && <p className="text-muted">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              cancel
            </button>
            <button className="btn-primary" disabled={!reason || state === "busy"}>
              {state === "busy" ? "…" : "send report"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
