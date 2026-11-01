"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BlurArea, Made, MakeFormat, MakeOptions, VoiceOver } from "@/lib/make";

const FORMATS: { value: MakeFormat; label: string; hint: string }[] = [
  { value: "wide", label: "Wide", hint: "YouTube, LinkedIn, X" },
  { value: "square", label: "Square", hint: "Feeds" },
  { value: "vertical", label: "Vertical", hint: "Reels, Shorts, TikTok" },
];
const input = "w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-border-strong";
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function Check({ label, value, set }: { label: string; value: boolean; set: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} className="accent-[var(--accent)]" />
      {label}
    </label>
  );
}

/** Other library videos to play after this one. */
function Clips({ id, clips, setClips }: { id: string; clips: string[]; setClips: (c: string[]) => void }) {
  const [library, setLibrary] = useState<{ id: string; title: string; status: string }[]>([]);
  useEffect(() => {
    fetch("/api/videos?limit=200").then((r) => (r.ok ? r.json() : [])).then(setLibrary).catch(() => {});
  }, []);
  const titleOf = (c: string) => library.find((v) => v.id === c)?.title ?? c;
  const choices = library.filter((v) => v.id !== id && v.status === "ready" && !clips.includes(v.id));
  const move = (i: number, by: number) => {
    const next = [...clips];
    const [c] = next.splice(i, 1);
    next.splice(i + by, 0, c);
    setClips(next);
  };
  return (
    <div className="space-y-2">
      <p className="label">clips to add after this video</p>
      {clips.map((c, i) => (
        <div key={c} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
          <span className="flex-1 truncate">{titleOf(c)}</span>
          <button className="text-muted disabled:opacity-30" disabled={i === 0} aria-label="Move up" onClick={() => move(i, -1)}>↑</button>
          <button className="text-muted disabled:opacity-30" disabled={i === clips.length - 1} aria-label="Move down" onClick={() => move(i, 1)}>↓</button>
          <button className="text-[12px] text-muted underline" onClick={() => setClips(clips.filter((x) => x !== c))}>remove</button>
        </div>
      ))}
      <select aria-label="Add a clip" className={input} value="" onChange={(e) => e.target.value && setClips([...clips, e.target.value])} disabled={!choices.length}>
        <option value="">{choices.length ? "add a video from your library…" : "no other finished videos yet"}</option>
        {choices.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
      </select>
    </div>
  );
}

/** Drag on the picture to hide an area; each area applies for a stretch of the video. */
function Blurs({ src, areas, setAreas }: { src: string; areas: BlurArea[]; setAreas: (a: BlurArea[]) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [length, setLength] = useState(0);
  const at = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const box = (d: NonNullable<typeof draft>) => ({ x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) });
  const patch = (i: number, change: Partial<BlurArea>) => setAreas(areas.map((a, n) => (n === i ? { ...a, ...change } : a)));
  const now = () => video.current?.currentTime ?? 0;
  const style = (a: { x: number; y: number; w: number; h: number }) => ({ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%` });
  return (
    <div className="space-y-2">
      <p className="label">blur sensitive areas</p>
      <p className="text-[12px] text-muted">Pause on the frame, then drag over what should be hidden. The hidden area can&apos;t be recovered from the finished video. Your recording itself isn&apos;t changed, so share the finished video.</p>
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video ref={video} src={src} controls muted playsInline preload="metadata" className="w-full" onLoadedMetadata={(e) => setLength(e.currentTarget.duration)} />
        <div
          className="absolute inset-x-0 top-0 bottom-12 cursor-crosshair touch-none"
          aria-label="Drag to add a blurred area"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = at(e);
            setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
          }}
          onPointerMove={(e) => {
            if (!draft) return;
            const p = at(e);
            setDraft({ ...draft, x1: p.x, y1: p.y });
          }}
          onPointerUp={() => {
            if (draft) {
              const b = box(draft);
              if (b.w > 0.01 && b.h > 0.01) setAreas([...areas, { ...b, start: 0, end: length || 1e6 }]);
            }
            setDraft(null);
          }}
        >
          {areas.map((a, i) => (
            <div key={i} className="absolute border border-white/80 bg-white/30 backdrop-blur-md" style={style(a)}><span className="p-1 text-[11px] text-white">{i + 1}</span></div>
          ))}
          {draft && <div className="absolute border border-dashed border-white bg-white/20" style={style(box(draft))} />}
        </div>
      </div>
      {areas.map((a, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-[12px]">
          <span>{i + 1}.</span>
          <span className="tabular-nums">{clock(a.start)} – {clock(Math.min(a.end, length || a.end))}</span>
          <button className="text-muted underline" onClick={() => patch(i, { start: now() })}>start here</button>
          <button className="text-muted underline" onClick={() => patch(i, { end: now() })}>end here</button>
          <button className="text-muted underline" onClick={() => setAreas(areas.filter((_, n) => n !== i))}>remove</button>
        </div>
      ))}
    </div>
  );
}

/** Talk over the video while it plays (muted) from wherever it's paused. */
function Voice({ id, src, edited, voice, reload, audio, setAudio }: { id: string; src: string; edited: boolean; voice: VoiceOver | null; reload: () => void; audio: MakeOptions["audio"]; setAudio: (a: MakeOptions["audio"]) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream } | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useLayoutEffect(() => {
    // Leaving the page (Next keeps it alive, hidden) must stop the microphone as well as the picture.
    const current = rec;
    const player = video;
    return () => {
      current.current?.recorder.stop();
      player.current?.pause();
    };
  }, []);

  async function start() {
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      const chunks: Blob[] = [];
      const from = video.current?.currentTime ?? 0;
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        video.current?.pause();
        rec.current = null;
        setRecording(false);
        setBusy(true);
        const r = await fetch(`/api/videos/${id}/voice?start=${from}&edited=${edited ? 1 : 0}`, { method: "POST", body: new Blob(chunks, { type: "audio/webm" }) }).catch(() => null);
        setBusy(false);
        if (!r?.ok) return setErr((await r?.json().catch(() => ({})))?.error ?? "Couldn't save the voice-over.");
        setAudio("voice");
        reload();
      };
      rec.current = { recorder, stream };
      recorder.start(1000);
      setRecording(true);
      await video.current?.play();
    } catch (e) {
      setErr((e as Error).name === "NotAllowedError" ? "Recap isn't allowed to use the microphone. Check your system's privacy settings." : `Couldn't start the microphone (${(e as Error).message}).`);
    }
  }

  return (
    <div className="space-y-2">
      <p className="label">voice-over</p>
      <p className="text-[12px] text-muted">Pause where you want to start, then record. The video plays silently while you talk. A new take replaces the last one.</p>
      <video ref={video} src={src} controls muted playsInline preload="metadata" className="max-h-[36vh] w-full rounded-lg bg-black" onEnded={() => rec.current?.recorder.stop()} />
      <div className="flex flex-wrap items-center gap-3">
        {recording
          ? <button className="btn-primary" onClick={() => rec.current?.recorder.stop()}>stop recording</button>
          : <button className="btn-ghost" disabled={busy} onClick={start}>{voice ? "record again" : "record voice-over"}</button>}
        {voice?.status === "transcribing" && <span className="text-[12px] text-muted">writing captions for your voice…</span>}
        {voice?.status === "ready" && (
          <>
            <audio controls src={`/api/videos/${id}/voice?audio&t=${voice.duration ?? 0}`} className="h-8 max-w-56" />
            <button className="text-[12px] text-muted underline" onClick={async () => { await fetch(`/api/videos/${id}/voice`, { method: "DELETE" }); setAudio("original"); reload(); }}>remove</button>
          </>
        )}
      </div>
      {voice?.status === "ready" && (
        <div className="flex flex-wrap gap-x-5 gap-y-1" role="radiogroup" aria-label="Sound in the finished video">
          {([["voice", "Voice-over only"], ["both", "Voice-over, original quietly under it"], ["original", "Original sound"]] as const).map(([v, label]) => (
            <label key={v} className="flex items-center gap-2"><input type="radio" name="sound" checked={audio === v} onChange={() => setAudio(v)} className="accent-[var(--accent)]" />{label}</label>
          ))}
        </div>
      )}
      {err && <p className="text-[12px]"><span className="text-muted">error: </span>{err}</p>}
    </div>
  );
}

/** A finished video for sharing: shape, captions, cards, joined clips, voice-over, blur. The recording isn't changed. */
export default function MakeVideo({ id, title, hasEdit }: { id: string; title: string; hasEdit: boolean }) {
  const [made, setMade] = useState<Made | null>(null);
  const [voice, setVoice] = useState<VoiceOver | null>(null);
  const [format, setFormat] = useState<MakeFormat>("wide");
  const [captions, setCaptions] = useState(true);
  const [intro, setIntro] = useState(false);
  const [introTitle, setIntroTitle] = useState(title);
  const [introSubtitle, setIntroSubtitle] = useState("");
  const [endCard, setEndCard] = useState(true);
  const [endTitle, setEndTitle] = useState(title);
  const [endLink, setEndLink] = useState("");
  const [small, setSmall] = useState(false);
  const [useEdit, setUseEdit] = useState(hasEdit);
  const [clips, setClips] = useState<string[]>([]);
  const [blurs, setBlurs] = useState<BlurArea[]>([]);
  const [audio, setAudio] = useState<MakeOptions["audio"]>("original");
  const [more, setMore] = useState<"" | "clips" | "blur" | "voice">("");
  const [rev, setRev] = useState(0);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);

  // Next keeps pages alive when you navigate away; without this the preview would keep playing, unseen.
  const player = useRef<HTMLVideoElement>(null);
  useLayoutEffect(() => {
    const pause = () => player.current?.pause();
    return pause;
  }, []);

  const rendering = made?.status === "rendering";
  const transcribing = voice?.status === "transcribing";
  useEffect(() => {
    let live = true;
    const load = async () => {
      const [m, v] = await Promise.all([fetch(`/api/videos/${id}/make`).catch(() => null), fetch(`/api/videos/${id}/voice`).catch(() => null)]);
      if (!live) return;
      if (v?.ok) setVoice((await v.json()).voice);
      if (m?.ok) {
        const next: Made | null = (await m.json()).made;
        if (live) setMade((old) => {
          if (old?.status === "rendering" && next?.status === "ready") setRev(Date.now());
          return next;
        });
      }
    };
    load();
    if (!rendering && !transcribing) return () => { live = false; };
    const t = setInterval(load, 1500);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [id, rendering, transcribing, tick]);

  // A voice-over and blurred areas are timed to one version of the video.
  const edited = hasEdit && (audio !== "original" && voice ? voice.edited : useEdit);
  const source = `/api/videos/${id}/media${edited ? "?v=clean" : ""}`;

  async function make() {
    setErr("");
    const options: MakeOptions = { format, captions, intro, introTitle, introSubtitle, endCard, endTitle, endLink, small, edited, clips, blurs, audio };
    const r = await fetch(`/api/videos/${id}/make`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options) });
    if (!r.ok) return setErr((await r.json().catch(() => ({}))).error ?? "Couldn't start.");
    setMade({ status: "rendering", options });
  }

  const extra = (key: "clips" | "blur" | "voice", label: string, count: number) => (
    <button aria-expanded={more === key} onClick={() => setMore(more === key ? "" : key)} className={`rounded-lg border px-3 py-1.5 ${more === key ? "border-border-strong" : "border-border text-muted"}`}>
      {label}{count ? ` · ${count}` : ""}
    </button>
  );

  return (
    <details className="card p-4 text-[13px]" aria-label="Make it a video">
      <summary className="cursor-pointer font-medium">Make it a video</summary>
      <div className="mt-4 space-y-4">
        <p className="text-[12px] text-muted">A finished video to share. Your recording stays as it is.</p>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Shape">
          {FORMATS.map((f) => (
            <button key={f.value} role="radio" aria-checked={format === f.value} onClick={() => setFormat(f.value)} className={`rounded-lg border px-3 py-2 text-left ${format === f.value ? "border-border-strong" : "border-border text-muted"}`}>
              <span className="block">{f.label}</span>
              <span className="block text-[11px] text-muted">{f.hint}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Check label="Captions" value={captions} set={setCaptions} />
          <Check label="Intro card" value={intro} set={setIntro} />
          <Check label="End card" value={endCard} set={setEndCard} />
          <Check label="Smaller file" value={small} set={setSmall} />
          {hasEdit && <Check label="Use my edit" value={useEdit} set={setUseEdit} />}
        </div>
        {intro && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block"><span className="label mb-1 block">intro title</span><input className={input} maxLength={120} value={introTitle} onChange={(e) => setIntroTitle(e.target.value)} /></label>
            <label className="block"><span className="label mb-1 block">subtitle</span><input className={input} maxLength={120} value={introSubtitle} onChange={(e) => setIntroSubtitle(e.target.value)} /></label>
          </div>
        )}
        {endCard && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block"><span className="label mb-1 block">end card title</span><input className={input} maxLength={120} value={endTitle} onChange={(e) => setEndTitle(e.target.value)} /></label>
            <label className="block"><span className="label mb-1 block">link or name</span><input className={input} maxLength={120} placeholder="yoursite.com" value={endLink} onChange={(e) => setEndLink(e.target.value)} /></label>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {extra("clips", "Join clips", clips.length)}
          {extra("voice", "Voice-over", voice ? 1 : 0)}
          {extra("blur", "Blur areas", blurs.length)}
        </div>
        {more === "clips" && <Clips id={id} clips={clips} setClips={setClips} />}
        {more === "voice" && <Voice id={id} src={source} edited={edited} voice={voice} reload={() => setTick((t) => t + 1)} audio={audio} setAudio={setAudio} />}
        {more === "blur" && <Blurs src={source} areas={blurs} setAreas={setBlurs} />}
        <button className="btn-primary" disabled={rendering || transcribing} onClick={make}>{rendering ? "making…" : made?.status === "ready" ? "make again" : "make video"}</button>
        {(err || made?.status === "error") && <p className="text-[12px]"><span className="text-muted">error: </span>{err || made?.error}</p>}
        {made?.status === "ready" && (
          <div className="space-y-2">
            <p className="text-[12px] text-muted">{FORMATS.find((f) => f.value === made.options.format)?.label} video{made.duration ? `, ${Math.round(made.duration)} seconds` : ""}</p>
            <video ref={player} key={rev} controls playsInline preload="metadata" src={`/api/videos/${id}/media?v=made${rev ? `&r=${rev}` : ""}`} className="max-h-[50vh] w-full rounded-lg bg-black" />
            <a className="btn-ghost inline-flex" href={`/api/videos/${id}/media?v=made&download`}>export mp4</a>
          </div>
        )}
      </div>
    </details>
  );
}
