"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fmtTime } from "@/lib/format";

type Mode = "screen-cam" | "screen" | "cam";
type Phase = "idle" | "countdown" | "recording" | "paused" | "uploading" | "error";
type BubbleSize = "s" | "m" | "l";

const BUBBLE_FRACTION: Record<BubbleSize, number> = { s: 0.14, m: 0.2, l: 0.28 };
const MAX_WIDTH = 1920;
const FPS = 30;

interface Bubble {
  /** Center, normalized 0..1 of the canvas. */
  x: number;
  y: number;
  size: BubbleSize;
}

// requestAnimationFrame stops when the tab is hidden (which it is while you record another
// window), and main-thread timers get throttled to 1 Hz. Timers inside a worker keep ticking.
function makeTicker(onTick: () => void) {
  const src = "let t;onmessage=e=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}";
  const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  const w = new Worker(url);
  w.onmessage = onTick;
  w.postMessage(1000 / FPS);
  return () => {
    w.postMessage(0);
    w.terminate();
    URL.revokeObjectURL(url);
  };
}

function pickMime() {
  const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

function drawCover(ctx: CanvasRenderingContext2D, v: HTMLVideoElement, x: number, y: number, w: number, h: number, mirror = false) {
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.max(w / vw, h / vh);
  const sw = w / scale;
  const sh = h / scale;
  ctx.save();
  if (mirror) {
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, w, h);
  } else {
    ctx.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, x, y, w, h);
  }
  ctx.restore();
}

function bubbleGeom(b: Bubble, W: number, H: number) {
  const r = (Math.min(W, H) * BUBBLE_FRACTION[b.size]) / 2 + Math.min(W, H) * 0.04;
  const cx = Math.min(W - r - 8, Math.max(r + 8, b.x * W));
  const cy = Math.min(H - r - 8, Math.max(r + 8, b.y * H));
  return { r, cx, cy };
}

export default function Recorder() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("screen-cam");
  const [micOn, setMicOn] = useState(true);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState("");
  const [micId, setMicId] = useState("");
  const [bubbleSize, setBubbleSize] = useState<BubbleSize>("m");
  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);
  const [title, setTitle] = useState("");
  const [pip, setPip] = useState<Window | null>(null);
  const pipRef = useRef<Window | null>(null);

  const camStream = useRef<MediaStream | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bubble = useRef<Bubble>({ x: 0.88, y: 0.82, size: "m" });
  const session = useRef<{
    recorder: MediaRecorder;
    chunks: Blob[];
    cleanup: () => void;
    startedAt: number;
    accumulated: number;
    discard: boolean;
  } | null>(null);

  const wantsCam = mode !== "screen";

  useEffect(() => {
    bubble.current.size = bubbleSize;
  }, [bubbleSize]);

  const refreshDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    setCams(all.filter((d) => d.kind === "videoinput" && d.deviceId));
    setMics(all.filter((d) => d.kind === "audioinput" && d.deviceId));
  }, []);

  // Live camera + mic preview while setting up. This same stream is reused for recording.
  useEffect(() => {
    if (phase !== "idle" && phase !== "error") return;
    let cancelled = false;
    let raf = 0;
    let audioCtx: AudioContext | null = null;
    (async () => {
      camStream.current?.getTracks().forEach((t) => t.stop());
      camStream.current = null;
      if (!wantsCam && !micOn) return;
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: wantsCam ? { deviceId: camId ? { exact: camId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } } : false,
          audio: micOn ? { deviceId: micId ? { exact: micId } : undefined, echoCancellation: true, noiseSuppression: true } : false,
        });
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        camStream.current = s;
        if (previewRef.current) previewRef.current.srcObject = s;
        setError("");
        refreshDevices();
        if (micOn && s.getAudioTracks().length) {
          audioCtx = new AudioContext();
          const an = audioCtx.createAnalyser();
          an.fftSize = 512;
          audioCtx.createMediaStreamSource(s).connect(an);
          const buf = new Uint8Array(an.fftSize);
          const loop = () => {
            an.getByteTimeDomainData(buf);
            let peak = 0;
            for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
            setLevel(peak / 128);
            raf = requestAnimationFrame(loop);
          };
          loop();
        }
      } catch (e) {
        if (!cancelled) setError(`Couldn't access ${wantsCam ? "camera" : "microphone"}: ${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      audioCtx?.close();
    };
  }, [wantsCam, micOn, camId, micId, phase, refreshDevices]);

  // Release devices when leaving the page.
  useEffect(() => () => {
    camStream.current?.getTracks().forEach((t) => t.stop());
    session.current?.cleanup();
  }, []);

  // Elapsed-time display.
  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => {
      const s = session.current;
      if (s) setElapsed((s.accumulated + performance.now() - s.startedAt) / 1000);
    }, 250);
    return () => clearInterval(t);
  }, [phase]);

  async function start() {
    setError("");
    let display: MediaStream | null = null;
    try {
      if (mode !== "cam") {
        display = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: FPS, width: { ideal: MAX_WIDTH }, height: { ideal: 1080 } },
          audio: true,
          // Chrome-specific hints: hide this tab from the picker, offer system/tab audio.
          selfBrowserSurface: "exclude",
          systemAudio: "include",
          surfaceSwitching: "include",
        } as DisplayMediaStreamOptions);
      }
    } catch (e) {
      if ((e as Error).name !== "NotAllowedError") setError((e as Error).message);
      return;
    }

    const cam = camStream.current;
    const camVideo = cam?.getVideoTracks().length ? cam : null;
    if (mode === "cam" && !camVideo) {
      setError("Camera isn't available.");
      return;
    }

    const mkVideo = (s: MediaStream) => {
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.srcObject = s;
      v.play().catch(() => {});
      return v;
    };
    const displayEl = display ? mkVideo(display) : null;
    const camEl = camVideo && mode !== "screen" ? mkVideo(camVideo) : null;

    let W = 1280;
    let H = 720;
    if (display && displayEl) {
      // Size the canvas from real frames. Right after getDisplayMedia, Chrome's track settings can
      // still report a placeholder (e.g. 640x360), which would lock the whole recording to it.
      if (!displayEl.videoWidth) {
        await new Promise<void>((resolve) => {
          const done = () => resolve();
          displayEl.addEventListener("resize", done, { once: true });
          displayEl.addEventListener("loadedmetadata", done, { once: true });
          setTimeout(done, 2000);
        });
      }
      const st = display.getVideoTracks()[0].getSettings();
      const sw = displayEl.videoWidth || st.width || 1920;
      const sh = displayEl.videoHeight || st.height || 1080;
      const scale = Math.min(1, MAX_WIDTH / sw);
      W = Math.round((sw * scale) / 2) * 2;
      H = Math.round((sh * scale) / 2) * 2;
    }
    const canvas = canvasRef.current!;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { alpha: false })!;

    const draw = () => {
      // The shared surface can change size mid-recording (window resize); letterbox it.
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      if (displayEl?.videoWidth) {
        const s = Math.min(W / displayEl.videoWidth, H / displayEl.videoHeight);
        const dw = displayEl.videoWidth * s;
        const dh = displayEl.videoHeight * s;
        ctx.drawImage(displayEl, (W - dw) / 2, (H - dh) / 2, dw, dh);
      }
      if (camEl) {
        if (!displayEl) {
          drawCover(ctx, camEl, 0, 0, W, H, true);
        } else {
          const { r, cx, cy } = bubbleGeom(bubble.current, W, H);
          ctx.save();
          ctx.shadowColor = "rgba(0,0,0,0.35)";
          ctx.shadowBlur = r * 0.15;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = "#fff";
          ctx.fill();
          ctx.restore();
          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, r - Math.max(3, r * 0.04), 0, Math.PI * 2);
          ctx.clip();
          drawCover(ctx, camEl, cx - r, cy - r, r * 2, r * 2, true);
          ctx.restore();
        }
      }
    };
    const stopTicker = makeTicker(draw);

    // Mix mic + shared tab/system audio into a single track.
    const audioCtx = new AudioContext();
    await audioCtx.resume();
    const dest = audioCtx.createMediaStreamDestination();
    let audioTracks = 0;
    for (const s of [micOn ? cam : null, display]) {
      if (s?.getAudioTracks().length) {
        audioCtx.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(dest);
        audioTracks++;
      }
    }

    const out = new MediaStream([
      ...canvas.captureStream(FPS).getVideoTracks(),
      ...(audioTracks ? dest.stream.getAudioTracks() : []),
    ]);
    const mimeType = pickMime();
    const recorder = new MediaRecorder(out, { mimeType, videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    const cleanup = () => {
      stopTicker();
      display?.getTracks().forEach((t) => t.stop());
      out.getTracks().forEach((t) => t.stop());
      audioCtx.close().catch(() => {});
    };
    session.current = { recorder, chunks, cleanup, startedAt: 0, accumulated: 0, discard: false };

    recorder.onstop = () => {
      const s = session.current;
      cleanup();
      session.current = null;
      if (!s || s.discard) {
        setPhase("idle");
        setElapsed(0);
        return;
      }
      upload(new Blob(chunks, { type: mimeType || "video/webm" }));
    };
    // "Stop sharing" in the browser bar ends the recording.
    display?.getVideoTracks()[0].addEventListener("ended", () => stop());

    setPhase("countdown");
    for (let i = 3; i > 0; i--) {
      setCount(i);
      await new Promise((r) => setTimeout(r, 1000));
      if (!session.current) return; // cancelled during countdown
    }
    recorder.start(1000);
    session.current.startedAt = performance.now();
    setElapsed(0);
    setPhase("recording");
  }

  function pause() {
    const s = session.current;
    if (!s || s.recorder.state !== "recording") return;
    s.recorder.pause();
    s.accumulated += performance.now() - s.startedAt;
    setPhase("paused");
  }

  function resume() {
    const s = session.current;
    if (!s || s.recorder.state !== "paused") return;
    s.recorder.resume();
    s.startedAt = performance.now();
    setPhase("recording");
  }

  function stop(discard = false) {
    const s = session.current;
    if (!s) return;
    s.discard = discard;
    pipRef.current?.close();
    if (s.recorder.state === "inactive") {
      // Still counting down: nothing recorded yet.
      s.cleanup();
      session.current = null;
      setPhase("idle");
      return;
    }
    s.recorder.stop();
  }

  function upload(blob: Blob) {
    setPhase("uploading");
    setProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/videos");
    xhr.setRequestHeader("Content-Type", blob.type);
    if (title.trim()) xhr.setRequestHeader("x-title", encodeURIComponent(title.trim()));
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status === 201) {
        router.push(`/v/${JSON.parse(xhr.responseText).id}`);
      } else {
        setError(`Upload failed (${xhr.status}). ${xhr.responseText}`);
        setPhase("error");
      }
    };
    xhr.onerror = () => {
      setError("Upload failed: network error.");
      setPhase("error");
    };
    xhr.send(blob);
  }

  // Document Picture-in-Picture: a camera bubble + controls that float above every app.
  async function popOut() {
    const dpip = (window as unknown as { documentPictureInPicture?: { requestWindow(o: object): Promise<Window> } }).documentPictureInPicture;
    if (!dpip) return;
    const w = await dpip.requestWindow({ width: 240, height: 300 });
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const style = w.document.createElement("style");
        style.textContent = Array.from(sheet.cssRules).map((r) => r.cssText).join("\n");
        w.document.head.appendChild(style);
      } catch {
        /* cross-origin sheet */
      }
    }
    w.document.documentElement.className = document.documentElement.className;
    w.document.body.className = "bg-bg text-text font-sans";
    w.addEventListener("pagehide", () => {
      pipRef.current = null;
      setPip(null);
    });
    pipRef.current = w;
    setPip(w);
  }

  // Drag the camera bubble around on the live preview.
  const dragging = useRef(false);
  function onPointer(e: React.PointerEvent<HTMLCanvasElement>) {
    if (mode !== "screen-cam") return;
    const c = e.currentTarget;
    const rect = c.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (e.type === "pointerdown") {
      const { r, cx, cy } = bubbleGeom(bubble.current, c.width, c.height);
      if (Math.hypot(x * c.width - cx, y * c.height - cy) <= r) {
        dragging.current = true;
        c.setPointerCapture(e.pointerId);
      }
    } else if (e.type === "pointermove" && dragging.current) {
      bubble.current.x = x;
      bubble.current.y = y;
    } else if (e.type === "pointerup") {
      dragging.current = false;
    }
  }

  const live = phase === "countdown" || phase === "recording" || phase === "paused";
  const pipSupported = typeof window !== "undefined" && "documentPictureInPicture" in window;

  const controls = (compact: boolean) => (
    <div className={`flex items-center gap-2 ${compact ? "justify-center" : ""}`}>
      <span className={`flex items-center gap-2 rounded-sm border border-border px-3 py-1.5 text-[13px] tabular-nums ${compact ? "px-2" : ""}`}>
        <span className={`h-2.5 w-2.5 rounded-full ${phase === "recording" ? "cursor-blink bg-text" : "bg-muted"}`} />
        {fmtTime(elapsed)}
      </span>
      {phase === "recording" ? (
        <button className="btn-ghost" onClick={pause} disabled={phase !== "recording"}>❚❚ pause</button>
      ) : (
        <button className="btn-ghost" onClick={resume} disabled={phase !== "paused"}>▶ resume</button>
      )}
      <button className="btn-primary" onClick={() => stop()} disabled={phase === "countdown"}>
        ■ stop
      </button>
    </div>
  );

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[1fr_320px]">
      <section className="card relative h-fit overflow-hidden">
        <div className="relative aspect-video bg-black">
          {/* Setup preview: just the camera (or a placeholder). */}
          <video
            ref={previewRef}
            muted
            playsInline
            autoPlay
            className={`absolute inset-0 h-full w-full -scale-x-100 object-cover ${live || !wantsCam ? "invisible" : ""}`}
          />
          {!live && !wantsCam && (
            <div className="absolute inset-0 grid place-items-center text-[13px] text-white/60">screen only · no camera</div>
          )}
          {/* While recording: the exact composited frame that's being recorded. */}
          <canvas
            ref={canvasRef}
            onPointerDown={onPointer}
            onPointerMove={onPointer}
            onPointerUp={onPointer}
            className={`absolute inset-0 h-full w-full object-contain ${live ? "" : "invisible"} ${mode === "screen-cam" ? "cursor-grab" : ""}`}
          />
          {phase === "countdown" && (
            <div className="absolute inset-0 grid place-items-center bg-black/50">
              <span className="text-8xl font-light text-white tabular-nums">{count}</span>
            </div>
          )}
          {phase === "uploading" && (
            <div className="absolute inset-0 grid place-items-center bg-black/70 text-white">
              <div className="w-64 text-center">
                <p className="mb-3 text-[13px]">uploading… {Math.round(progress * 100)}%</p>
                <div className="h-px overflow-hidden bg-white/20">
                  <div className="h-full bg-white transition-all" style={{ width: `${progress * 100}%` }} />
                </div>
              </div>
            </div>
          )}
        </div>
        {live && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-3">
            {controls(false)}
            <div className="flex items-center gap-2">
              {pipSupported && !pip && phase !== "countdown" && (
                <button className="btn-ghost" onClick={popOut} title="Float the camera and controls above other apps">
                  pop out
                </button>
              )}
              <button className="btn-danger" onClick={() => stop(true)}>discard</button>
            </div>
          </div>
        )}
      </section>

      <aside className="card h-fit space-y-5 p-5">
        <div>
          <h1 className="text-[15px] font-medium">new recording</h1>
          <p className="mt-1 text-[13px] text-muted">
            {mode === "screen-cam" && "drag the camera bubble on the preview to move it."}
            {mode === "screen" && "records the screen, window, or tab you pick."}
            {mode === "cam" && "full-frame camera recording."}
          </p>
        </div>

        <fieldset disabled={live || phase === "uploading"} className="space-y-5 disabled:opacity-60">
          <div className="grid grid-cols-3 gap-0.5 rounded-sm border border-border p-0.5 text-[12px]">
            {([
              ["screen-cam", "screen+cam"],
              ["screen", "screen"],
              ["cam", "cam"],
            ] as const).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`whitespace-nowrap rounded-sm px-1 py-1.5 ${mode === m ? "bg-accent text-accent-text" : "text-muted hover:text-text"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="block text-[13px]">
            <span className="label mb-1.5 block">title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="untitled recording"
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 outline-none focus:border-accent"
            />
          </label>

          {wantsCam && (
            <label className="block text-[13px]">
              <span className="label mb-1.5 block">camera</span>
              <select
                value={camId}
                onChange={(e) => setCamId(e.target.value)}
                className="w-full rounded-sm border border-border bg-surface px-3 py-2"
              >
                <option value="">default camera</option>
                {cams.map((c) => (
                  <option key={c.deviceId} value={c.deviceId}>{c.label || "Camera"}</option>
                ))}
              </select>
            </label>
          )}

          <div className="text-[13px]">
            <div className="mb-1 flex items-center justify-between">
              <span className="label">microphone</span>
              <button
                role="switch"
                aria-checked={micOn}
                onClick={() => setMicOn(!micOn)}
                className={`relative h-4 w-8 rounded-sm border transition ${micOn ? "border-accent bg-accent" : "border-border"}`}
              >
                <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-[1px] transition-all ${micOn ? "left-[18px] bg-accent-text" : "left-0.5 bg-muted"}`} />
              </button>
            </div>
            {micOn && (
              <>
                <select
                  value={micId}
                  onChange={(e) => setMicId(e.target.value)}
                  className="w-full rounded-sm border border-border bg-surface px-3 py-2"
                >
                  <option value="">default microphone</option>
                  {mics.map((m) => (
                    <option key={m.deviceId} value={m.deviceId}>{m.label || "Microphone"}</option>
                  ))}
                </select>
                <div className="mt-2 h-px overflow-hidden bg-border">
                  <div className="h-full bg-accent transition-[width] duration-75" style={{ width: `${Math.min(100, level * 180)}%` }} />
                </div>
              </>
            )}
          </div>

          {mode === "screen-cam" && (
            <div className="text-[13px]">
              <span className="label mb-1.5 block">bubble</span>
              <div className="grid grid-cols-3 gap-0.5 rounded-sm border border-border p-0.5 text-[12px]">
                {(["s", "m", "l"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setBubbleSize(s)}
                    className={`rounded-sm py-1 ${bubbleSize === s ? "bg-accent text-accent-text" : "text-muted hover:text-text"}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </fieldset>

        {error && <p className="rounded-sm border border-border-strong p-3 text-[12px]"><span className="text-muted">error: </span>{error}</p>}

        {!live && phase !== "uploading" && (
          <button className="btn-primary w-full py-3" onClick={start}>
            <span className="h-2 w-2 rounded-full bg-current" /> start recording
          </button>
        )}
        {mode !== "cam" && (
          <p className="text-[11px] leading-5 text-muted">
            tip: pick a Chrome tab and tick “Share tab audio” to include its sound. System audio for full-screen
            capture depends on your OS.
          </p>
        )}
      </aside>

      {pip &&
        createPortal(
          <div className="flex h-full flex-col items-center justify-center gap-3 p-3">
            {wantsCam && camStream.current?.getVideoTracks().length ? (
              <video
                muted
                playsInline
                autoPlay
                ref={(v) => {
                  if (v && v.srcObject !== camStream.current) v.srcObject = camStream.current;
                }}
                className="aspect-square w-44 -scale-x-100 rounded-full border border-border-strong object-cover grayscale-0"
              />
            ) : null}
            {controls(true)}
          </div>,
          pip.document.body,
        )}
    </div>
  );
}
