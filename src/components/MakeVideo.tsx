"use client";

import { useEffect, useState } from "react";
import type { Made, MakeFormat } from "@/lib/make";

const FORMATS: { value: MakeFormat; label: string; hint: string }[] = [
  { value: "wide", label: "Wide", hint: "YouTube, LinkedIn, X" },
  { value: "square", label: "Square", hint: "Feeds" },
  { value: "vertical", label: "Vertical", hint: "Reels, Shorts, TikTok" },
];

/** A finished video for sharing: the right shape, captions burned in and an end card. The recording isn't changed. */
export default function MakeVideo({ id, title, hasEdit }: { id: string; title: string; hasEdit: boolean }) {
  const [made, setMade] = useState<Made | null>(null);
  const [format, setFormat] = useState<MakeFormat>("wide");
  const [captions, setCaptions] = useState(true);
  const [endCard, setEndCard] = useState(true);
  const [endTitle, setEndTitle] = useState(title);
  const [endLink, setEndLink] = useState("");
  const [small, setSmall] = useState(false);
  const [useEdit, setUseEdit] = useState(hasEdit);
  const [rev, setRev] = useState(0);
  const [err, setErr] = useState("");

  const rendering = made?.status === "rendering";
  useEffect(() => {
    let live = true;
    const load = async () => {
      const r = await fetch(`/api/videos/${id}/make`).catch(() => null);
      if (!live || !r?.ok) return;
      const next: Made | null = (await r.json()).made;
      setMade((old) => {
        if (old?.status === "rendering" && next?.status === "ready") setRev(Date.now());
        return next;
      });
    };
    load();
    if (!rendering) return () => { live = false; };
    const t = setInterval(load, 1500);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [id, rendering]);

  async function make() {
    setErr("");
    const r = await fetch(`/api/videos/${id}/make`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format, captions, endCard, endTitle, endLink, small, edited: hasEdit && useEdit }),
    });
    if (!r.ok) return setErr((await r.json().catch(() => ({}))).error ?? "Couldn't start.");
    setMade({ status: "rendering", options: { format, captions, endCard, endTitle, endLink, small, edited: hasEdit && useEdit } });
  }

  const check = (label: string, value: boolean, set: (v: boolean) => void) => (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} className="accent-[var(--accent)]" />
      {label}
    </label>
  );
  const input = "w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-border-strong";

  return (
    <details className="card p-4 text-[13px]" aria-label="Make it a video">
      <summary className="cursor-pointer font-medium">Make it a video</summary>
      <div className="mt-4 space-y-4">
        <p className="text-[12px] text-muted">A finished video to share, with captions and an end card. Your recording stays as it is.</p>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Shape">
          {FORMATS.map((f) => (
            <button
              key={f.value}
              role="radio"
              aria-checked={format === f.value}
              onClick={() => setFormat(f.value)}
              className={`rounded-lg border px-3 py-2 text-left ${format === f.value ? "border-border-strong" : "border-border text-muted"}`}
            >
              <span className="block">{f.label}</span>
              <span className="block text-[11px] text-muted">{f.hint}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {check("Captions", captions, setCaptions)}
          {check("End card", endCard, setEndCard)}
          {check("Smaller file", small, setSmall)}
          {hasEdit && check("Use my edit", useEdit, setUseEdit)}
        </div>
        {endCard && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block"><span className="label mb-1 block">end card title</span><input className={input} maxLength={120} value={endTitle} onChange={(e) => setEndTitle(e.target.value)} /></label>
            <label className="block"><span className="label mb-1 block">link or name</span><input className={input} maxLength={120} placeholder="yoursite.com" value={endLink} onChange={(e) => setEndLink(e.target.value)} /></label>
          </div>
        )}
        <button className="btn-primary" disabled={rendering} onClick={make}>{rendering ? "making…" : made?.status === "ready" ? "make again" : "make video"}</button>
        {(err || made?.status === "error") && <p className="text-[12px]"><span className="text-muted">error: </span>{err || made?.error}</p>}
        {made?.status === "ready" && (
          <div className="space-y-2">
            <video key={rev} controls playsInline preload="metadata" src={`/api/videos/${id}/media?v=made${rev ? `&r=${rev}` : ""}`} className="max-h-[50vh] w-full rounded-lg bg-black" />
            <a className="btn-ghost inline-flex" href={`/api/videos/${id}/media?v=made&download`}>export mp4</a>
          </div>
        )}
      </div>
    </details>
  );
}
