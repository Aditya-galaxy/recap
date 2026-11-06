"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cutRanges, keepRanges, remap, remapSpan, total } from "@/lib/cuts";
import { fmtDate, fmtTime } from "@/lib/format";
import { ShareToCloud } from "@/components/CloudShare";
import DesktopShare from "@/components/DesktopShare";
import { GuidePanel } from "@/components/Guide";
import { ReportPanel } from "@/components/Report";
import MakeVideo from "@/components/MakeVideo";
import TrimBar from "@/components/TrimBar";
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
  type Tab = "transcript" | "comments" | "guide" | "report" | "insights";
  const [tab, setTab] = useState<Tab>("transcript");
  // Local (desktop) libraries have one person, so comments and insights only exist on servers.
  const tabs: Tab[] = local ? ["transcript", "guide", "report"] : owner ? ["transcript", "comments", "guide", "report", "insights"] : ["transcript", "comments"];
  const tabLabel: Record<Tab, string> = { transcript: "Transcript", comments: "Comments", guide: "Guide", report: "Bug report", insights: "Insights" };
  const [opts, setOpts] = useState<CleanOptions>(initialMeta.clean.options ?? DEFAULT_CLEAN);
  const [fineTune, setFineTune] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [now, setNow] = useState(0);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rev, setRev] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeWord = useRef<HTMLSpanElement>(null);
  const transcriptBox = useRef<HTMLDivElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const id = meta.id;
  const cleanStatus = useRef(initialMeta.clean.status);
  const viewCounted = useRef(false);

  // Next keeps pages alive (hidden) when you navigate away, so the video would keep playing with no player
  // on screen. This cleanup runs when the page is hidden as well as when it goes for good.
  useLayoutEffect(() => {
    const pause = () => videoRef.current?.pause();
    return pause;
  }, []);

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
  const trimStart = opts.trimStart ?? 0;
  const trimEnd = opts.trimEnd ?? duration;

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

  // Follow along inside the transcript box only; the page itself must not move while the video plays.
  useEffect(() => {
    const w = activeWord.current;
    const box = transcriptBox.current;
    if (!w || !box) return;
    if (w.offsetTop < box.scrollTop || w.offsetTop > box.scrollTop + box.clientHeight - 48) box.scrollTo({ top: w.offsetTop - 48, behavior: "smooth" });
  }, [Math.floor(origNow)]); // eslint-disable-line react-hooks/exhaustive-deps

  // The bar works on the original timeline, so moving a trim handle shows the original at that moment.
  function showOriginalAt(t: number) {
    const v = videoRef.current;
    v?.pause();
    setPreviewing(false);
    setNow(t);
    if (version === "original") {
      if (v) v.currentTime = t;
    } else {
      pendingSeek.current = t;
      setVersion("original");
    }
  }

  function setTrim(start: number, end: number, moved: number) {
    const s = Math.round(start * 10) / 10;
    const e = Math.round(end * 10) / 10;
    setOpts({ ...opts, trimStart: s > 0 ? s : undefined, trimEnd: duration - e > 0.15 ? e : undefined });
    showOriginalAt(moved);
  }

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

  const saved = meta.clean.status === "ready" && !!meta.clean.options && sameEdit(opts, meta.clean.options);
  const q = version === "clean" ? "?v=clean" : "";
  const ready = meta.status === "ready";
  const words = transcript?.words ?? [];

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {meta.disabled && (
        <p className="mb-4 rounded-lg border border-border-strong px-3 py-2 text-[12px]">
          This video was taken down after a report. Only {owner ? "you" : "its owner"} and admins can open it.
        </p>
      )}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
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
                  {v === "unlisted" ? "Link" : "Private"}
                </button>
              ))}
            </div>
          )}
          {!local && <button className="btn-primary" onClick={copyLink}>{copied ? "Copied ✓" : "Copy link"}</button>}
          {cloudShare && ready && <ShareToCloud videoId={id} version={version} canClean={meta.clean.status === "ready"} />}
          {local && ready && <DesktopShare video={{ id, version, title: meta.title }} />}
          {ready && (
            <a className="btn-ghost" href={`/api/videos/${id}/media?${version === "clean" ? "v=clean&" : ""}download`}>
              {local ? "Export MP4" : "Download"}
            </a>
          )}
        </div>
      </div>

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
            onLoadedMetadata={(e) => {
              setNow(0);
              if (pendingSeek.current === null) return;
              e.currentTarget.currentTime = pendingSeek.current;
              pendingSeek.current = null;
            }}
            className="aspect-video max-h-[50vh] w-full bg-black"
            src={`/api/videos/${id}/media${q}${rev ? `${q ? "&" : "?"}r=${rev}` : ""}`}
          >
            {words.length > 0 && (
              <track kind="captions" srcLang="en" label="English" default src={`/api/videos/${id}/captions${q}`} />
            )}
          </video>
        ) : (
          <div className="grid aspect-video max-h-[50vh] w-full place-items-center bg-surface-2 text-center">
            {meta.status === "error" ? (
              <div className="max-w-md p-6">
                <p className="font-medium">Processing failed</p>
                <p className="mt-2 break-words text-[12px] text-muted">{meta.error}</p>
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

      {ready && !local && <div className="mt-3"><ReactionsBar videoId={id} now={origNow} duration={duration} /></div>}
      {!owner && !local && <div className="mt-3"><ReportButton videoId={id} /></div>}
      {meta.clean.status === "ready" && (
        <div className="mt-4 inline-grid grid-cols-2 gap-0.5 rounded-lg border border-border p-0.5 text-[12px]">
          {(["clean", "original"] as const).map((v) => (
            <button
              key={v}
              onClick={() => {
                setVersion(v);
                setPreviewing(false);
              }}
              className={`rounded-lg px-3 py-1.5 ${version === v ? "bg-accent text-accent-text" : "text-muted hover:text-text"}`}
            >
              {v === "clean" ? `Edited · ${fmtTime(meta.clean.duration)}` : `Original · ${fmtTime(meta.duration)}`}
            </button>
          ))}
        </div>
      )}

      {owner && ready && duration > 0 && (
        <section className="mt-6 space-y-5 text-[13px]" aria-label="Edit">
          <div className="space-y-2">
            <TrimBar duration={duration} start={trimStart} end={trimEnd} cuts={draftCuts} now={origNow} onSeek={showOriginalAt} onTrim={setTrim} />
            <div className="flex justify-between text-[12px] tabular-nums text-muted">
              <span>{fmtTime(trimStart)} – {fmtTime(trimEnd)}</span>
              <span>
                {draftSaved > 0 ? `${fmtTime(duration - draftSaved)} long, ${fmtTime(draftSaved)} shorter` : `${fmtTime(duration)} long`}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
            <div className="flex min-w-64 flex-1 items-center gap-5">
              <div className="flex-1">
                <Toggle
                  label="Clean up"
                  hint={`${counts.hesitation} um/uh, ${counts.pauses} long pauses`}
                  checked={opts.fillers || opts.silences}
                  onChange={(v) => setOpts({ ...opts, fillers: v, silences: v })}
                />
              </div>
              <button className="text-[12px] text-muted hover:text-text" aria-expanded={fineTune} onClick={() => setFineTune((o) => !o)}>
                Options
              </button>
            </div>
            <div className="flex gap-2">
              <button
                className="btn-ghost"
                disabled={!draftCuts.length}
                onClick={() => {
                  if (previewing) return setPreviewing(false);
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
                {previewing ? "Stop preview" : "Preview"}
              </button>
              <button className="btn-primary" disabled={busy || saved || !draftCuts.length || meta.clean.status === "rendering"} onClick={render}>
                {meta.clean.status === "rendering" ? "Saving…" : saved ? "Saved" : "Save edit"}
              </button>
            </div>
          </div>

          {fineTune && (
            <div className="space-y-5 rounded-lg border border-border p-5">
              <Toggle label="Remove filler words" hint={`${counts.hesitation} um/uh found`} checked={opts.fillers} onChange={(v) => setOpts({ ...opts, fillers: v })} />
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
                    <span className="label">Pause threshold</span>
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
              <p className="text-[12px] text-muted">Your original stays untouched.</p>
            </div>
          )}

          {(err || meta.clean.status === "error") && (
            <p className="rounded-lg border border-border-strong p-3 text-[12px]"><span className="text-muted">Error: </span>{err || meta.clean.error}</p>
          )}
        </section>
      )}

      {owner && ready && (
        <div className="mt-6">
          <MakeVideo id={id} title={meta.title} hasEdit={meta.clean.status === "ready"} onCleanStarted={() => setMeta((m) => ({ ...m, clean: { ...m.clean, status: "rendering" } }))} />
        </div>
      )}

      <section className="mt-12">
        <div className="mb-5 flex gap-6 border-b border-border" role="tablist">
          {tabs.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 pb-2 text-[13px] font-medium ${tab === t ? "border-border-strong text-text" : "border-transparent text-muted hover:text-text"}`}
            >
              {tabLabel[t]}
            </button>
          ))}
        </div>

        <div className="card flex max-h-[min(70vh,560px)] flex-col overflow-hidden">
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
            <p className="p-5 text-[13px] text-muted">Transcript appears once processing finishes.</p>
          ) : tab === "guide" ? (
            <GuidePanel videoId={id} onSeek={seekOriginal} />
          ) : tab === "report" ? (
            <ReportPanel videoId={id} onSeek={seekOriginal} />
          ) : (
            <div ref={transcriptBox} className="relative overflow-y-auto p-6 text-[14px] leading-8">
              {words.length === 0 ? (
                <p className="text-[13px] text-muted">No speech detected.</p>
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
          )}
        </div>
      </section>

      {owner && (
        <button className="mt-12 text-[12px] text-muted hover:text-text" onClick={remove}>
          Delete this video
        </button>
      )}
    </div>
  );
}

/** Would rendering these options produce the same video? */
function sameEdit(a: CleanOptions, b: CleanOptions) {
  return (
    a.fillers === b.fillers &&
    a.silences === b.silences &&
    a.minSilence === b.minSilence &&
    a.aggressive === b.aggressive &&
    a.trimStart === b.trimStart &&
    a.trimEnd === b.trimEnd
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-3 text-left">
      <span>
        <span className="block">{label}</span>
        <span className="block text-[12px] text-muted">{hint}</span>
      </span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 ${checked ? "bg-accent" : "bg-[color-mix(in_srgb,var(--text)_16%,transparent)]"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--surface)] shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-[left] duration-150 ${checked ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}
