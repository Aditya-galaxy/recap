"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cutRanges, keepRanges, remap, remapSpan, total } from "@/lib/cuts";
import { fmtDate, fmtTime } from "@/lib/format";
import { ShareToCloud } from "@/components/CloudShare";
import DesktopShare from "@/components/DesktopShare";
import { GuidePanel } from "@/components/Guide";
import { ReportPanel } from "@/components/Report";
import { CommentsPanel, InsightsPanel, ReactionsBar, ReportButton, type Viewer } from "@/components/Social";
import { DEFAULT_CLEAN, type CleanOptions, type Range, type Transcript, type VideoMeta } from "@/lib/types";

type Version = "original" | "clean";

export default function Watch({
  initialMeta,
  initialTranscript,
  owner,
  shareUrl,
  local = false,
  cloudShare = false,
  viewer = null,
}: {
  initialMeta: VideoMeta;
  initialTranscript: Transcript | null;
  owner: boolean;
  shareUrl: string;
  local?: boolean;
  /** Desktop app connected to a Recap server (RECAP_CLOUD_URL): offer "share link". */
  cloudShare?: boolean;
  viewer?: Viewer | null;
}) {
  const router = useRouter();
  const [meta, setMeta] = useState(initialMeta);
  const [transcript, setTranscript] = useState(initialTranscript);
  const [version, setVersion] = useState<Version>(initialMeta.clean.status === "ready" ? "clean" : "original");
  type Tab = "transcript" | "comments" | "clean" | "guide" | "report" | "insights";
  const [tab, setTab] = useState<Tab>("transcript");
  // Local (desktop) libraries have one person, so comments and insights only exist on servers.
  const tabs: Tab[] = local ? ["transcript", "clean", "guide", "report"] : owner ? ["transcript", "comments", "clean", "guide", "report", "insights"] : ["transcript", "comments"];
  const tabLabel: Record<Tab, string> = { transcript: "transcript", comments: "comments", clean: "clean up", guide: "guide", report: "bug", insights: "insights" };
  const [opts, setOpts] = useState<CleanOptions>(initialMeta.clean.options ?? DEFAULT_CLEAN);
  const [previewing, setPreviewing] = useState(false);
  const [now, setNow] = useState(0);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rev, setRev] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeWord = useRef<HTMLSpanElement>(null);
  const id = meta.id;
  const cleanStatus = useRef(initialMeta.clean.status);
  const viewCounted = useRef(false);

  // Poll while the server is doing work.
  const working = meta.status === "uploaded" || meta.status === "processing" || meta.clean.status === "rendering";
  useEffect(() => {
    if (!working) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/videos/${id}`);
      if (!r.ok) return;
      const j = (await r.json()) as { meta: VideoMeta; transcript: Transcript | null };
      if (cleanStatus.current === "rendering" && j.meta.clean.status === "ready") {
        setVersion("clean");
        setRev((n) => n + 1);
      }
      cleanStatus.current = j.meta.clean.status;
      setMeta(j.meta);
      if (j.transcript) setTranscript(j.transcript);
    }, 1500);
    return () => clearInterval(t);
  }, [working, id]);

  const duration = meta.duration ?? 0;

  // What the current panel settings would cut (live estimate + preview playback).
  const draftCuts = useMemo(() => (transcript && duration ? cutRanges(transcript, opts, duration) : []), [transcript, opts, duration]);
  const draftSaved = total(draftCuts);

  // The timeline of the rendered clean cut, to map transcript words onto it.
  const renderedKeep = useMemo<Range[] | null>(() => {
    if (meta.clean.status !== "ready" || !meta.clean.options || !transcript || !duration) return null;
    return keepRanges(cutRanges(transcript, meta.clean.options, duration), duration);
  }, [meta.clean, transcript, duration]);

  const onClean = version === "clean" && !!renderedKeep;

  const counts = useMemo(() => {
    const w = transcript?.words ?? [];
    return {
      hesitation: w.filter((x) => x.filler === "hesitation").length,
      discourse: w.filter((x) => x.filler === "discourse").length,
      pauses: (transcript?.silences ?? []).filter((s) => s.end - s.start >= opts.minSilence).length,
    };
  }, [transcript, opts.minSilence]);

  // Original-timeline time of the playhead.
  const origNow = useMemo(() => {
    if (!onClean || !renderedKeep) return now;
    let acc = 0;
    for (const k of renderedKeep) {
      const len = k.end - k.start;
      if (now <= acc + len) return k.start + (now - acc);
      acc += len;
    }
    return duration;
  }, [now, onClean, renderedKeep, duration]);

  function onTime() {
    const v = videoRef.current;
    if (!v) return;
    // "Preview cut" plays the original but jumps over everything the current settings would remove.
    if (previewing && version === "original") {
      const c = draftCuts.find((r) => v.currentTime >= r.start && v.currentTime < r.end - 0.02);
      if (c) v.currentTime = c.end;
    }
    setNow(v.currentTime);
    if (!v.paused) pingView();
  }

  function seekOriginal(t: number) {
    const v = videoRef.current;
    if (!v) return;
    const target = onClean && renderedKeep ? remap(t, renderedKeep) : t;
    if (target === null) return;
    v.currentTime = target;
    v.play().catch(() => {});
  }

  // ?t=12.3 (from a guide step) opens the original at that moment.
  useEffect(() => {
    const t = Number(new URLSearchParams(window.location.search).get("t"));
    const v = videoRef.current;
    if (!t || !v) return;
    setVersion("original");
    const go = () => (v.currentTime = t);
    if (v.readyState >= 1) go();
    else v.addEventListener("loadedmetadata", go, { once: true });
  }, []);

  useEffect(() => {
    activeWord.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [Math.floor(origNow)]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveTitle(t: string) {
    setEditing(false);
    const title = t.trim();
    if (!title || title === meta.title) return;
    const r = await fetch(`/api/videos/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });
    if (r.ok) setMeta(await r.json());
  }

  async function render() {
    setBusy(true);
    setErr("");
    const r = await fetch(`/api/videos/${id}/clean`, { method: "POST", body: JSON.stringify(opts) });
    setBusy(false);
    if (!r.ok) return setErr((await r.json().catch(() => ({}))).error ?? "Failed to start");
    setPreviewing(false);
    cleanStatus.current = "rendering";
    setMeta((m) => ({ ...m, clean: { status: "rendering", options: opts } }));
  }

  async function remove() {
    if (!confirm("Delete this video? This can't be undone.")) return;
    await fetch(`/api/videos/${id}`, { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  // Viewer insights: report how far the viewer got when playback starts, every 10 s, and on pause/end.
  // Throttled by playback position (every 10 s of video), not wall-clock time.
  const lastPing = useRef(-Infinity);
  function pingView(force = false) {
    if (owner || local) return;
    const v = videoRef.current;
    if (!force && Math.abs(origNow - lastPing.current) < 10) return;
    lastPing.current = origNow;
    const progress = duration ? Math.min(1, origNow / duration) : 0;
    fetch(`/api/videos/${id}/view`, { method: "POST", body: JSON.stringify({ progress: v?.ended ? 1 : progress }), keepalive: true }).catch(() => {});
  }
  function onPlay() {
    viewCounted.current = true;
    pingView(true);
  }

  async function setVisibility(visibility: VideoMeta["visibility"]) {
    const r = await fetch(`/api/videos/${id}`, { method: "PATCH", body: JSON.stringify({ visibility }) });
    if (r.ok) setMeta(await r.json());
  }

  function copyLink() {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const q = version === "clean" ? "?v=clean" : "";
  const ready = meta.status === "ready";
  const words = transcript?.words ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {meta.disabled && (
        <p className="mb-4 rounded-lg border border-border-strong px-3 py-2 text-[12px]">
          This video was taken down after a report. Only {owner ? "you" : "its owner"} and admins can open it.
        </p>
      )}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {owner && editing ? (
            <input
              autoFocus
              defaultValue={meta.title}
              onBlur={(e) => saveTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditing(false);
              }}
              className="w-full rounded-lg border border-border-strong bg-surface px-2 py-1 text-[17px] font-medium outline-none"
            />
          ) : (
            <h1
              className={`truncate rounded-lg px-2 py-1 text-[17px] font-medium ${owner ? "cursor-text hover:bg-surface-2" : ""}`}
              title={owner ? "Click to rename" : undefined}
              onClick={() => owner && setEditing(true)}
            >
              {meta.title}
            </h1>
          )}
          <p className="px-2 text-[12px] text-muted">
            {fmtDate(meta.createdAt)}
            {meta.duration ? ` · ${fmtTime(onClean ? meta.clean.duration : meta.duration)}` : ""}
            {onClean && meta.clean.duration && fmtTime(meta.clean.duration) !== fmtTime(meta.duration) ? ` (was ${fmtTime(meta.duration)})` : ""}
            {owner && !local ? ` · ${meta.views} view${meta.views === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2">
          {owner && !local && (
            <div className="inline-grid grid-cols-2 gap-0.5 rounded-lg border border-border p-0.5 text-[12px]" title="Who can watch">
              {(["unlisted", "private"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setVisibility(v)}
                  title={v === "unlisted" ? "Anyone with the link" : "Only you"}
                  className={`rounded-lg px-2.5 py-1 ${meta.visibility === v ? "bg-accent text-accent-text" : "text-muted hover:text-text"}`}
                >
                  {v === "unlisted" ? "link" : "private"}
                </button>
              ))}
            </div>
          )}
          {!local && <button className="btn-primary" onClick={copyLink}>{copied ? "copied ✓" : "copy link"}</button>}
          {cloudShare && ready && <ShareToCloud videoId={id} version={version} canClean={meta.clean.status === "ready"} />}
          {local && ready && <DesktopShare video={{ id, version, title: meta.title }} />}
          {ready && (
            <a className="btn-ghost" href={`/api/videos/${id}/media?${version === "clean" ? "v=clean&" : ""}download`}>
              {local ? `export ${version === "clean" ? "cleaned " : ""}mp4` : "download"}
            </a>
          )}
          {owner && <button className="btn-danger" onClick={remove}>delete</button>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          <div className="card overflow-hidden">
            {ready ? (
              <video
                key={`${version}-${rev}`}
                ref={videoRef}
                controls
                playsInline
                preload="metadata"
                poster={`/api/videos/${id}/thumb`}
                onTimeUpdate={onTime}
                onPlay={onPlay}
                onPause={() => pingView(true)}
                onEnded={() => pingView(true)}
                onSeeked={onTime}
                className="aspect-video w-full bg-black"
                src={`/api/videos/${id}/media${q}${rev ? `${q ? "&" : "?"}r=${rev}` : ""}`}
              >
                {words.length > 0 && (
                  <track kind="captions" srcLang="en" label="English" default src={`/api/videos/${id}/captions${q}`} />
                )}
              </video>
            ) : (
              <div className="grid aspect-video place-items-center bg-surface-2 text-center">
                {meta.status === "error" ? (
                  <div className="max-w-md p-6">
                    <p className="font-medium">processing failed</p>
                    <p className="mt-2 break-words font-mono text-xs text-muted">{meta.error}</p>
                  </div>
                ) : (
                  <div className="w-56 space-y-3">
                    <p className="text-[13px] text-muted">{meta.stage ?? "Processing"}…</p>
                    <div className="working-bar" aria-hidden="true" />
                  </div>
                )}
              </div>
            )}
          </div>

          {ready && !local && <ReactionsBar videoId={id} now={origNow} duration={duration} />}
          {!owner && !local && <ReportButton videoId={id} />}
          {meta.clean.status === "ready" && (
            <div className="inline-grid grid-cols-2 gap-0.5 rounded-lg border border-border p-0.5 text-[12px]">
              {(["clean", "original"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setVersion(v);
                    setPreviewing(false);
                  }}
                  className={`rounded-lg px-3 py-1.5 ${version === v ? "bg-accent text-accent-text" : "text-muted hover:text-text"}`}
                >
                  {v === "clean" ? `cleaned · ${fmtTime(meta.clean.duration)}` : `original · ${fmtTime(meta.duration)}`}
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="card flex max-h-[min(80vh,640px)] flex-col overflow-hidden">
          <div className="grid border-b border-border text-[13px]" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`border-b py-2.5 text-[12px] uppercase tracking-[0.12em] ${tab === t ? "border-border-strong text-text" : "border-transparent text-muted hover:text-text"}`}
              >
                {tabLabel[t]}
              </button>
            ))}
          </div>

          {tab === "comments" ? (
            <CommentsPanel
              videoId={id}
              viewer={viewer}
              owner={owner}
              now={origNow}
              onSeek={seekOriginal}
              loginHref={`/login?next=${encodeURIComponent(`/v/${id}`)}`}
            />
          ) : tab === "insights" ? (
            <InsightsPanel videoId={id} />
          ) : !ready ? (
            <p className="p-5 text-[13px] text-muted">transcript appears once processing finishes.</p>
          ) : tab === "guide" ? (
            <GuidePanel videoId={id} onSeek={seekOriginal} />
          ) : tab === "report" ? (
            <ReportPanel videoId={id} onSeek={seekOriginal} />
          ) : tab === "transcript" ? (
            <div className="overflow-y-auto p-5 text-[13px] leading-7">
              {words.length === 0 ? (
                <p className="text-[13px] text-muted">no speech detected.</p>
              ) : (
                words.map((w, i) => {
                  const active = origNow >= w.start && origNow < w.end;
                  const cutInClean = onClean && renderedKeep && remapSpan(w, renderedKeep) === null;
                  return (
                    <span key={i}>
                      <span
                        ref={active ? activeWord : undefined}
                        onClick={() => seekOriginal(onClean ? (w.start + w.end) / 2 : w.start)}
                        title={fmtTime(w.start)}
                        className={[
                          "cursor-pointer px-0.5 hover:bg-accent-soft",
                          active ? "bg-accent text-accent-text hover:bg-accent" : "",
                          w.filler && !active ? "text-muted underline decoration-dotted underline-offset-4" : "",
                          cutInClean ? "line-through opacity-50" : "",
                        ].join(" ")}
                      >
                        {w.text}
                      </span>{" "}
                    </span>
                  );
                })
              )}
            </div>
          ) : (
            <div className="space-y-5 overflow-y-auto p-5 text-[13px]">
              <p className="text-muted">
                removes hesitations and dead air using word timestamps and pause detection. Your original stays
                untouched.
              </p>

              <Toggle
                label="Remove filler words"
                hint={`${counts.hesitation} um/uh found`}
                checked={opts.fillers}
                onChange={(v) => setOpts({ ...opts, fillers: v })}
              />
              {opts.fillers && (
                <Toggle
                  label="Also cut “like,” “you know,” “basically,”"
                  hint={`${counts.discourse} found, only when set off by commas`}
                  checked={opts.aggressive}
                  onChange={(v) => setOpts({ ...opts, aggressive: v })}
                />
              )}
              <Toggle
                label="Shorten long pauses"
                hint={`${counts.pauses} pauses over ${opts.minSilence.toFixed(1)}s`}
                checked={opts.silences}
                onChange={(v) => setOpts({ ...opts, silences: v })}
              />
              {opts.silences && (
                <label className="block">
                  <span className="mb-1 flex justify-between">
                    <span className="label">pause threshold</span>
                    <span className="text-[12px]">{opts.minSilence.toFixed(1)}s</span>
                  </span>
                  <input
                    type="range"
                    min={0.4}
                    max={3}
                    step={0.1}
                    value={opts.minSilence}
                    onChange={(e) => setOpts({ ...opts, minSilence: Number(e.target.value) })}
                    className="w-full accent-[var(--accent)]"
                  />
                </label>
              )}

              <div className="rounded-lg border border-dashed border-border p-4">
                <p className="text-2xl font-light tabular-nums">−{fmtTime(draftSaved)}</p>
                <p className="text-muted">
                  {duration ? `${Math.round((draftSaved / duration) * 100)}% shorter · ` : ""}
                  new length {fmtTime(duration - draftSaved)}
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  className="btn-ghost flex-1"
                  disabled={!draftCuts.length}
                  onClick={() => {
                    setVersion("original");
                    setPreviewing(true);
                    setTimeout(() => {
                      const v = videoRef.current;
                      if (v) {
                        v.currentTime = 0;
                        v.play().catch(() => {});
                      }
                    }, 50);
                  }}
                >
                  {previewing ? "previewing…" : "preview"}
                </button>
                <button
                  className="btn-primary flex-1"
                  disabled={busy || !draftCuts.length || meta.clean.status === "rendering"}
                  onClick={render}
                >
                  {meta.clean.status === "rendering" ? "rendering…" : meta.clean.status === "ready" ? "re-render" : "render clean cut"}
                </button>
              </div>
              {previewing && (
                <button className="text-xs text-accent underline" onClick={() => setPreviewing(false)}>
                  stop skipping cuts
                </button>
              )}
              {(err || meta.clean.status === "error") && (
                <p className="rounded-lg border border-border-strong p-3 text-[12px]"><span className="text-muted">error: </span>{err || meta.clean.error}</p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-3 text-left">
      <span>
        <span className="block">{label}</span>
        <span className="block text-[11px] text-muted">{hint}</span>
      </span>
      <span className={`relative h-4 w-8 shrink-0 rounded-lg border transition ${checked ? "border-accent bg-accent" : "border-border"}`}>
        <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-[1px] transition-all ${checked ? "left-[18px] bg-accent-text" : "left-0.5 bg-muted"}`} />
      </span>
    </button>
  );
}
