import "server-only";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { config } from "./config";
import { cutRanges, keepRanges, snapToSilences, tagFillers, total } from "./cuts";
import { exists, file, readMeta, readTranscript, updateMeta } from "./store";
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
function inspect(p: string): Promise<{ duration: number; width?: number; height?: number; video: number; audio: number }> {
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
  await run(WHISPER_BIN, ["-m", WHISPER_MODEL, "-f", wav, "-ojf", "-of", outBase, "-np", "-nfa", "--prompt", WHISPER_PROMPT]);
  const j = JSON.parse(await fs.readFile(outBase + ".json", "utf8"));
  const words: Word[] = [];
  let cur: Word | null = null;
  for (const seg of j.transcription ?? []) {
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

/** Transcode → thumbnail → transcribe → detect silences. Throws on failure; the job queue retries. */
export async function processVideo(id: string) {
  const stage = (s: string) => updateMeta(id, (m) => { m.status = "processing"; m.stage = s; });
  const src = file(id, "original"); // webm from the browser/Electron, mp4/mov from the Mac app
  const mp4 = file(id, "video.mp4");
  const wav = file(id, "audio.wav");

  if (!(await exists(src))) {
    // A previous attempt finished encoding and removed the upload; only metadata steps remain.
    if (!(await exists(mp4))) throw new PermanentError("Upload is missing.");
  } else {
    await stage("Checking upload");
    const info0 = await inspect(src).catch(() => ({ video: 0 }));
    if (!info0.video) throw new PermanentError("That file isn't a video Recap can read.");

    await stage("Encoding video");
    // MediaRecorder output is variable-frame-rate and lacks a seek index; normalize to CFR H.264.
    // CRF 20 / faster: ~49 dB PSNR on scrolling 1080p UI text (vs 45 dB at CRF 23), leaving headroom for
    // the clean cut's second encode, for ~33% more bytes.
    // The Mac app records system audio and mic as separate tracks; ffmpeg would keep only one.
    const nAudio = await audioStreamCount(src);
    const audioArgs =
      nAudio > 1
        ? ["-filter_complex", `${Array.from({ length: nAudio }, (_, i) => `[0:a:${i}]`).join("")}amix=inputs=${nAudio}:normalize=0[a]`, "-map", "0:v:0", "-map", "[a]"]
        : [];
    const tmp = file(id, "video.tmp.mp4");
    await run("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error", "-i", src,
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-fps_mode", "cfr", "-r", "30", ...audioArgs,
      "-c:v", "libx264", "-preset", "faster", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", tmp,
    ]);
    await fs.rename(tmp, mp4);
  }
  const info = await probe(mp4);
  await updateMeta(id, (m) => { m.duration = info.duration; m.width = info.width; m.height = info.height; });

  await run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error", "-ss", String(Math.min(1, info.duration / 2)), "-i", mp4,
    "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", file(id, "thumb.jpg"),
  ]);

  let transcript: Transcript = { words: [], silences: [] };
  if (await hasAudio(mp4)) {
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", mp4, "-ar", "16000", "-ac", "1", wav]);
    await stage("Transcribing");
    const words = await transcribe(id, wav);
    await stage("Finding pauses");
    const silences = await detectSilences(wav, info.duration);
    transcript = { words: snapToSilences(words, silences), silences };
    await fs.rm(wav, { force: true });
    await fs.rm(file(id, "whisper.json"), { force: true });
  }
  await fs.writeFile(file(id, "transcript.json"), JSON.stringify(transcript));
  await fs.rm(src, { force: true });
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
  const sel = keep.map((k) => `between(t,${k.start.toFixed(3)},${k.end.toFixed(3)})`).join("+");
  const audio = await hasAudio(file(id, "video.mp4"));
  const graph = [`[0:v]select='${sel}',setpts=N/FRAME_RATE/TB[v]`];
  if (audio) graph.push(`[0:a]aselect='${sel}',asetpts=N/SR/TB[a]`);
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
