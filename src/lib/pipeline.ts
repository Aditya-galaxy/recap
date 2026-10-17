import "server-only";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { config } from "./config";
import { CUT_FPS, cutRanges, keepRanges, snapToSilences, tagFillers, total } from "./cuts";
import { exists, file, readMeta, readTranscript, setTranscriptText, updateMeta } from "./store";
import type { CleanOptions, Range, Transcript, Word } from "./types";

const WHISPER_BIN = config.whisperBin;
const WHISPER_MODEL = config.whisperModel;

/** An error retrying won't fix (bad upload, nothing to render). */
export class PermanentError extends Error {}
// Priming the decoder with disfluencies stops Whisper from silently "cleaning up" ums and uhs.
const WHISPER_PROMPT = "Um, so, uh, I was like, you know, thinking. Hmm.";

// Bundled binaries in the desktop app; PATH lookups on servers.
const BIN: Record<string, string> = { ffmpeg: config.ffmpegBin };

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(BIN[cmd] ?? cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-800)}`)),
    );
  });
}

/**
 * Stream and duration info from `ffmpeg -i`, so ffprobe doesn't need to ship with the desktop app.
 * ffmpeg exits non-zero here ("no output file"); the header it prints on stderr is what we read.
 */
function inspect(p: string): Promise<{ duration: number; width?: number; height?: number; video: number; audio: number; vcodec?: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(BIN.ffmpeg, ["-hide_banner", "-i", p], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let err = "";
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", reject);
    proc.on("close", () => {
      const streams = err.split("\n").filter((l) => /^\s*Stream #\d+:\d+/.test(l));
      const videoLines = streams.filter((l) => /: Video: /.test(l) && !/attached pic/.test(l));
      const size = videoLines[0]?.match(/, (\d{2,5})x(\d{2,5})[\s,]/);
      const d = err.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
      resolve({
        vcodec: videoLines[0]?.match(/: Video: (\w+)/)?.[1],
        duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0,
        width: size ? Number(size[1]) : undefined,
        height: size ? Number(size[2]) : undefined,
        video: videoLines.length,
        audio: streams.filter((l) => /: Audio: /.test(l)).length,
      });
    });
  });
}

const probe = (p: string) => inspect(p);
const audioStreamCount = async (p: string) => (await inspect(p)).audio;
const hasAudio = async (p: string) => (await audioStreamCount(p)) > 0;

async function detectSilences(wav: string, duration: number): Promise<Range[]> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", wav, "-af", "silencedetect=noise=-35dB:d=0.4", "-f", "null", "-"]);
  const out: Range[] = [];
  let start: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = line.match(/silence_start: (-?[\d.]+)/);
    if (s) start = Math.max(0, Number(s[1]));
    const e = line.match(/silence_end: ([\d.]+)/);
    if (e && start !== null) {
      out.push({ start, end: Number(e[1]) });
      start = null;
    }
  }
  if (start !== null) out.push({ start, end: duration });
  return out;
}

async function transcribe(id: string, wav: string): Promise<Word[]> {
  const outBase = file(id, "whisper");
  // -nfa: whisper.cpp enables flash attention by default, which badly skews token timestamps
  // around pauses. -ojf gives per-token offsets, which are tighter than its word-split mode.
  // -bs 1 -bo 1 (greedy, with whisper's temperature fallback): 36% faster than the default 5-wide beam on a
  // 10-minute benchmark, with no loss in word error rate or filler detection.
  // --vad: the Silero model drops background noise, music and silence before decoding, so whisper doesn't
  // invent words there (measured: noise-only audio went from "[sound of water]" to nothing, and speech in
  // noise stopped picking up phantom "ah"s). Timestamps stay on the original timeline.
  // With VAD, whisper.cpp maps segment times back to the original timeline but not token times, so ask for
  // one word per segment (-ml 1 -sow) and read words from segments: every word keeps its real position.
  const vad = await exists(config.vadModel);
  const vadArgs = vad ? ["--vad", "-vm", config.vadModel, "-ml", "1", "-sow"] : [];
  await run(WHISPER_BIN, ["-m", WHISPER_MODEL, "-f", wav, "-ojf", "-of", outBase, "-np", "-nfa", "-bs", "1", "-bo", "1", ...vadArgs, "--prompt", WHISPER_PROMPT]);
  const j = JSON.parse(await fs.readFile(outBase + ".json", "utf8"));
  const words: Word[] = [];
  let cur: Word | null = null;
  for (const seg of vad ? [] : (j.transcription ?? [])) {
    for (const tok of seg.tokens ?? []) {
      const text: string = tok.text ?? "";
      // Special tokens: [_BEG_], [_TT_123] timing markers and <|endoftext|>-style control tokens.
      if (!text || /^\s*\[_[^\]]*\]$/.test(text) || /^\s*<\|[^|]*\|>\s*$/.test(text)) continue;
      const from = tok.offsets.from / 1000;
      const to = tok.offsets.to / 1000;
      if (/^\s/.test(text) || !cur) {
        if (cur) words.push(cur);
        cur = { start: from, end: to, text: text.trim() };
      } else {
        cur.text += text;
        // Punctuation tokens tend to bleed into the following pause; don't let them extend the word.
        if (/[a-z0-9]/i.test(text)) cur.end = to;
      }
    }
  }
  if (cur) words.push(cur);
  if (vad) {
    for (const seg of j.transcription ?? []) {
      const text = String(seg.text ?? "").replace(/<\|[^|]*\|>/g, "").trim();
      if (text && !/^\[_[^\]]*\]$/.test(text)) words.push({ start: seg.offsets.from / 1000, end: seg.offsets.to / 1000, text });
    }
  }
  // Drop non-speech annotations like [BLANK_AUDIO], (music), [Phone ringing] (may span words).
  const speech: Word[] = [];
  let inMarker = false;
  for (const w of words) {
    if (!inMarker && /^[[(]/.test(w.text)) inMarker = true;
    if (!inMarker && w.text) speech.push(w);
    if (inMarker && /[\])][.,!?]?$/.test(w.text)) inMarker = false;
  }
  return tagFillers(speech);
}

/**
 * Upload → watchable video + transcript. Two independent tracks run in parallel:
 *  - video: H.264 recordings (what the desktop and Mac apps produce) are remuxed in seconds; anything
 *    else is re-encoded to CFR H.264. Then a thumbnail.
 *  - audio: extract → whisper → pause detection.
 * Throws on failure; the job queue retries.
 */
export async function processVideo(id: string) {
  const started = performance.now();
  const timings: Record<string, number> = {};
  const timed = async <T,>(name: string, fn: () => Promise<T>) => {
    const t = performance.now();
    try {
      return await fn();
    } finally {
      timings[name] = performance.now() - t;
    }
  };
  const src = file(id, "original"); // webm/mkv from the browser/desktop app, mp4/mov from the Mac app
  const mp4 = file(id, "video.mp4");
  const wav = file(id, "audio.wav");

  const haveSrc = await exists(src);
  // After a crash the upload may already have become video.mp4; carry on from there.
  if (!haveSrc && !(await exists(mp4))) throw new PermanentError("Upload is missing.");
  const srcInfo = haveSrc ? await inspect(src).catch(() => null) : null;
  if (haveSrc && !srcInfo?.video) throw new PermanentError("That file isn't a video Recap can read.");
  const provided = file(id, "transcript.provided.json");
  const transcribing = srcInfo?.audio !== 0 && config.serverTranscribe && !(await exists(provided));
  await updateMeta(id, (m) => { m.status = "processing"; m.stage = transcribing ? "Processing + transcribing" : "Processing video"; });

  // The Mac app records system audio and mic as separate tracks; mix them instead of keeping one.
  const audioMap = (n: number) =>
    n > 1
      ? ["-filter_complex", `${Array.from({ length: n }, (_, i) => `[0:a:${i}]`).join("")}amix=inputs=${n}:normalize=0[a]`, "-map", "[a]"]
      : n === 1 ? ["-map", "0:a:0"] : [];

  const videoTrack = async () => {
    if (haveSrc && srcInfo) {
      const even = !!srcInfo.width && !!srcInfo.height && srcInfo.width % 2 === 0 && srcInfo.height % 2 === 0;
      const remux = srcInfo.vcodec === "h264" && even;
      // CRF 20 / faster: ~49 dB PSNR on scrolling 1080p UI text (vs 45 dB at CRF 23).
      const videoArgs = remux
        ? ["-c:v", "copy", "-video_track_timescale", "90000"]
        : ["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-fps_mode", "cfr", "-r", "30", "-c:v", "libx264", "-preset", "faster", "-crf", "20", "-pix_fmt", "yuv420p"];
      const tmp = file(id, "video.tmp.mp4");
      await timed(remux ? "remux" : "encode", () =>
        run("ffmpeg", [
          "-y", "-hide_banner", "-loglevel", "error", "-i", src, "-map", "0:v:0", ...audioMap(srcInfo.audio),
          ...videoArgs, "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", tmp,
        ]),
      );
      await fs.rename(tmp, mp4);
    }
    const info = await probe(mp4);
    await updateMeta(id, (m) => { m.duration = info.duration; m.width = info.width; m.height = info.height; });
    await timed("thumbnail", () =>
      run("ffmpeg", [
        "-y", "-hide_banner", "-loglevel", "error", "-ss", String(Math.min(1, info.duration / 2)), "-i", mp4,
        "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", file(id, "thumb.jpg"),
      ]),
    );
  };

  const audioTrack = async (): Promise<Transcript> => {
    // Made on the uploader's machine (desktop app) and validated on upload: nothing to transcribe here.
    if (await exists(provided)) return JSON.parse(await fs.readFile(provided, "utf8"));
    if (!config.serverTranscribe) return { words: [], silences: [] };
    const from = haveSrc ? src : mp4;
    const n = haveSrc ? (srcInfo?.audio ?? 0) : (await inspect(mp4)).audio;
    if (!n) return { words: [], silences: [] };
    await timed("extract audio", () => run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", from, ...audioMap(n), "-ar", "16000", "-ac", "1", wav]));
    const length = (await inspect(wav)).duration;
    const silences = await timed("pauses", () => detectSilences(wav, length));
    // All silence (mic off, or the recorder's placeholder track): nothing to transcribe, and whisper tends to
    // invent a "Thank you." on silence.
    const quiet = silences.reduce((s, r) => s + (r.end - r.start), 0);
    const words = length > 0 && quiet >= length - 0.25 ? [] : await timed("transcribe", () => transcribe(id, wav));
    await fs.rm(wav, { force: true });
    await fs.rm(file(id, "whisper.json"), { force: true });
    return { words: snapToSilences(words, silences), silences };
  };

  // allSettled, so a failure on one track never leaves the other's ffmpeg/whisper running unobserved.
  const [video, audio] = await Promise.allSettled([videoTrack(), audioTrack()]);
  if (video.status === "rejected") throw video.reason;
  if (audio.status === "rejected") throw audio.reason;

  await fs.writeFile(file(id, "transcript.json"), JSON.stringify(audio.value));
  setTranscriptText(id, audio.value);
  await fs.rm(src, { force: true });
  await fs.rm(provided, { force: true });
  const total = (performance.now() - started) / 1000;
  const media = (await readMeta(id))?.duration ?? 0;
  console.log(
    `[pipeline] ${id} ${media.toFixed(0)}s video ready in ${total.toFixed(1)}s (${media ? (total / media).toFixed(3) : "?"}x realtime): ` +
      Object.entries(timings).map(([n, ms]) => `${n} ${(ms / 1000).toFixed(1)}s`).join(", "),
  );
  await updateMeta(id, (m) => { m.status = "ready"; delete m.stage; delete m.error; });
}

/** Validate a clean-up request and mark it as rendering. The render itself runs as a job. */
export async function prepareClean(id: string, opts: CleanOptions) {
  const meta = await readMeta(id);
  const t = await readTranscript(id);
  if (!meta?.duration || !t) throw new PermanentError("Video isn't ready yet.");
  const keep = keepRanges(cutRanges(t, opts, meta.duration), meta.duration);
  if (keep.length === 0) throw new PermanentError("Those settings would cut the whole video.");
  await updateMeta(id, (m) => { m.clean = { status: "rendering", options: opts }; });
}

/** Render a cleaned cut with fillers and long pauses removed. */
export async function renderClean(id: string, opts: CleanOptions) {
  const meta = await readMeta(id);
  const t = await readTranscript(id);
  if (!meta?.duration || !t) throw new PermanentError("Video isn't ready yet.");
  const keep = keepRanges(cutRanges(t, opts, meta.duration), meta.duration);
  // Each kept span is a half-open [start, end) test. They're combined as a balanced tree: a flat
  // "a+b+c+…" chain nests as deep as the number of cuts and ffmpeg's expression parser runs out of
  // memory around ~180 of them (it failed on a 10-minute recording).
  const tree = (terms: string[]): string => {
    if (terms.length === 1) return terms[0];
    const mid = terms.length >> 1;
    return `(${tree(terms.slice(0, mid))}+${tree(terms.slice(mid))})`;
  };
  // Video frames sit exactly on k/CUT_FPS after fps=…; compare against half-frame offsets so float
  // rounding can't add or drop a frame at a boundary. Audio uses the exact boundaries.
  const half = 0.5 / CUT_FPS;
  const vsel = tree(keep.map((k) => `gte(t,${(k.start - half).toFixed(6)})*lt(t,${(k.end - half).toFixed(6)})`));
  const asel = tree(keep.map((k) => `gte(t,${k.start.toFixed(6)})*lt(t,${k.end.toFixed(6)})`));
  const audio = await hasAudio(file(id, "video.mp4"));
  // fps first: remuxed hardware-encoder video is variable frame rate, and setpts=N/FRAME_RATE assumes CFR.
  const graph = [`[0:v]fps=${CUT_FPS},select='${vsel}',setpts=N/FRAME_RATE/TB[v]`];
  // aselect keeps or drops whole audio frames. Re-chunk into 1 ms frames first so every cut is within
  // 1 ms of the video's. Measured on a 10-minute, 180-cut render: 64 ms of drift with the default ~21 ms
  // frames, 13 ms with 1 ms frames (+5 s render time).
  if (audio) graph.push(`[0:a]aresample=48000,asetnsamples=n=48:p=0,aselect='${asel}',asetpts=N/SR/TB[a]`);
  const graphFile = file(id, "clean.filter");
  await fs.writeFile(graphFile, graph.join(";"));
  const tmp = file(id, "clean.tmp.mp4");
  await run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error", "-i", file(id, "video.mp4"),
    "-/filter_complex", graphFile, "-map", "[v]", ...(audio ? ["-map", "[a]"] : []),
    "-c:v", "libx264", "-preset", "faster", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", tmp,
  ]);
  await fs.rename(tmp, file(id, "clean.mp4"));
  await fs.writeFile(file(id, "clean.keep.json"), JSON.stringify(keep));
  await updateMeta(id, (m) => { m.clean = { status: "ready", options: opts, duration: total(keep) }; });
}

/** Is the toolchain installed? Used by /api/health. */
export async function toolchain() {
  const ok = async (cmd: string, args: string[]) => run(cmd, args).then(() => true, () => false);
  return {
    ffmpeg: await ok("ffmpeg", ["-version"]),
    whisper: await ok(WHISPER_BIN, ["--help"]),
    model: await exists(WHISPER_MODEL),
  };
}

export async function readKeep(id: string): Promise<Range[] | null> {
  const p = file(id, "clean.keep.json");
  if (!(await exists(p))) return null;
  return JSON.parse(await fs.readFile(p, "utf8"));
}
