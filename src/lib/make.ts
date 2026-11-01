import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { toCues } from "./captions";
import { inspect, PermanentError, readKeep, run, transcribe } from "./pipeline";
import { file, readMeta, readTranscript } from "./store";
import type { Word } from "./types";

/**
 * "Make it a video": turns a recording or its edit into a finished video for sharing: the shape a platform
 * wants, captions burned in (most social video plays muted) and an end card. The source is never changed.
 */

export type MakeFormat = "wide" | "square" | "vertical";
/** A region to hide, as fractions of the picture, for a stretch of the main video's timeline. */
export type BlurArea = { x: number; y: number; w: number; h: number; start: number; end: number };
export type MakeOptions = {
  format: MakeFormat;
  captions: boolean;
  /** Title card before the video. */
  intro: boolean;
  introTitle: string;
  introSubtitle: string;
  endCard: boolean;
  endTitle: string;
  endLink: string;
  /** Smaller file for email and chat: 720p and stronger compression. */
  small: boolean;
  /** Use the saved edit rather than the original. */
  edited: boolean;
  /** Other videos to play after this one, in order. */
  clips: string[];
  blurs: BlurArea[];
  /** "voice" replaces the sound with the voice-over; "both" keeps the original quietly underneath. */
  audio: "original" | "voice" | "both";
};
export type Made = { status: "rendering" | "ready" | "error"; options: MakeOptions; error?: string; duration?: number };
export type VoiceOver = { status: "transcribing" | "ready" | "error"; start: number; edited: boolean; duration?: number; words?: Word[]; error?: string };

const END_SECONDS = 3.5;
const INTRO_SECONDS = 3;
const FADE = 0.4;
const FONT = "Geist";
const FONT_FILE = "Geist-Regular.ttf";
const DIMENSIONS: Record<MakeFormat, [number, number]> = { wide: [1920, 1080], square: [1080, 1080], vertical: [1080, 1920] };

export const madeFile = (format: MakeFormat) => `made-${format}.mp4`;
const jsonPath = (id: string) => file(id, "make.json");

export async function readMade(id: string): Promise<Made | null> {
  try {
    return JSON.parse(await fs.readFile(jsonPath(id), "utf8"));
  } catch {
    return null;
  }
}
export const writeMade = (id: string, made: Made) => fs.writeFile(jsonPath(id), JSON.stringify(made));

/** Text can come from a transcript or a title: it must not be able to act as subtitle formatting. */
const assText = (s: string) => s.replace(/\\/g, "/").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\s+/g, " ").trim();

const assTime = (s: number) => {
  const cs = Math.max(0, Math.round(s * 100));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(cs / 360000)}:${p(Math.floor(cs / 6000) % 60)}:${p(Math.floor(cs / 100) % 60)}.${p(cs % 100)}`;
};

function assFile(w: number, h: number, styles: string[], events: string[]) {
  return [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${w}`, `PlayResY: ${h}`, "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ...styles, "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events, "",
  ].join("\n");
}

const voicePath = (id: string) => file(id, "voice.json");
export async function readVoice(id: string): Promise<VoiceOver | null> {
  try {
    return JSON.parse(await fs.readFile(voicePath(id), "utf8"));
  } catch {
    return null;
  }
}
export const writeVoice = (id: string, v: VoiceOver) => fs.writeFile(voicePath(id), JSON.stringify(v));

/** Voice-over takes get their own transcript, so captions can follow what's actually said. */
export async function transcribeVoice(id: string) {
  const voice = await readVoice(id);
  if (!voice) return;
  const wav = file(id, "voice.wav");
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", file(id, "voice.webm"), "-ar", "16000", "-ac", "1", wav]);
  const words = await transcribe(id, wav).catch(() => [] as Word[]);
  const { duration } = await inspect(wav);
  await fs.rm(wav, { force: true });
  await fs.rm(file(id, "whisper.json"), { force: true });
  await writeVoice(id, { ...voice, status: "ready", duration, words });
}

type Size = { W: number; H: number; unit: number; format: MakeFormat };
type Cue = { start: number; end: number; text: string };

function captionFile(s: Size, cues: Cue[]) {
  const size = Math.round((s.format === "vertical" ? 62 : 52) * s.unit);
  const margin = Math.round(s.H * (s.format === "vertical" ? 0.16 : 0.07));
  const side = Math.round(s.W * 0.07);
  return assFile(s.W, s.H,
    [`Style: Cap,${FONT},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H99000000,1,0,0,0,100,100,0,0,3,${Math.round(14 * s.unit)},0,2,${side},${side},${margin},1`],
    cues.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(Math.max(c.end, c.start + 0.6))},Cap,,0,0,0,,${assText(c.text)}`),
  );
}

/** Blur that can't be undone: the region is shrunk to a few pixels and scaled back, so no text survives. */
function blurGraph(from: string, blurs: BlurArea[], width: number, height: number) {
  const graph: string[] = [];
  let cur = from;
  blurs.forEach((b, i) => {
    const px = (f: number, full: number) => Math.round(Math.min(1, Math.max(0, f)) * full);
    const x = px(b.x, width);
    const y = px(b.y, height);
    const w = Math.max(4, Math.min(px(b.w, width), width - x));
    const h = Math.max(4, Math.min(px(b.h, height), height - y));
    // Each blur cell is at least half the area's height, so text filling the area loses even its word shapes,
    // which a fixed-size blur leaves readable on a big headline. Small areas still get a strong minimum.
    const cell = Math.max((32 * height) / 1080, Math.min(w, h) / 2);
    const small = (n: number) => Math.max(2, Math.round(n / cell));
    graph.push(`[${cur}]split=2[keep${i}][area${i}]`);
    graph.push(`[area${i}]crop=${w}:${h}:${x}:${y},scale=${small(w)}:${small(h)}:flags=area,scale=${w}:${h}:flags=bicubic[blur${i}]`);
    graph.push(`[keep${i}][blur${i}]overlay=${x}:${y}:enable='between(t,${b.start.toFixed(3)},${b.end.toFixed(3)})'[after${i}]`);
    cur = `after${i}`;
  });
  return { graph, out: cur };
}

const ENCODE = (small: boolean) => ["-c:v", "libx264", "-preset", "faster", "-crf", small ? "27" : "20", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", small ? "96k" : "160k"];

export async function makeVideo(id: string, opts: MakeOptions) {
  const meta = await readMeta(id);
  if (!meta?.duration) throw new PermanentError("Video isn't ready yet.");
  const [fullW, fullH] = DIMENSIONS[opts.format];
  const scale = opts.small ? 2 / 3 : 1;
  const W = Math.round((fullW * scale) / 2) * 2;
  const H = Math.round((fullH * scale) / 2) * 2;
  const size: Size = { W, H, unit: Math.min(W, H) / 1080, format: opts.format };

  // Everything is written next to the video and ffmpeg runs from there: filter strings can then use plain
  // relative names, with no escaping for spaces, quotes or a drive letter in the person's folder path.
  const dir = path.dirname(file(id, "video.mp4"));
  const temp: string[] = [FONT_FILE];
  const name = (n: string) => {
    temp.push(n);
    return n;
  };
  await fs.copyFile(path.join(process.cwd(), "public", "fonts", FONT_FILE), path.join(dir, FONT_FILE));

  /** One piece of the finished video, always the same size, frame rate and sound format, so pieces join cleanly. */
  const segment = async (n: number, sourceId: string, edited: boolean, main: boolean, fadeIn: boolean, fadeOut: boolean) => {
    const keep = edited ? await readKeep(sourceId) : null;
    const source = file(sourceId, keep ? "clean.mp4" : "video.mp4");
    const info = await inspect(source).catch(() => null);
    if (!info?.duration || !info.width || !info.height) throw new PermanentError(main ? "That video can't be read." : "One of the added clips can't be read. It may have been deleted.");
    const dur = info.duration;
    const voice = main && opts.audio !== "original" ? await readVoice(sourceId) : null;
    const graph: string[] = [];
    const inputs = ["-i", source];
    let video = "0:v";
    if (main && opts.blurs.length) {
      const blurred = blurGraph(video, opts.blurs, info.width, info.height);
      graph.push(...blurred.graph);
      video = blurred.out;
    }
    if (Math.abs(info.width / info.height - W / H) < 0.01) {
      graph.push(`[${video}]scale=${W}:${H}:flags=lanczos,setsar=1,fps=30,format=yuv420p[base]`);
    } else {
      // A different shape: the whole picture stays visible, over a blurred copy of itself.
      graph.push(`[${video}]split=2[bgsrc][fgsrc]`);
      graph.push(`[bgsrc]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:2,eq=brightness=-0.12[bg]`);
      graph.push(`[fgsrc]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1[fg]`);
      graph.push("[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30,format=yuv420p[base]");
    }
    video = "base";
    if (opts.captions) {
      // Short lines: a caption has to be read at a glance, and a tall video has less width.
      const most = opts.format === "vertical" ? 5 : 8;
      const words = voice?.words?.length
        ? voice.words.map((w) => ({ ...w, start: w.start + voice.start, end: w.end + voice.start }))
        : opts.audio === "voice" && main ? [] : (await readTranscript(sourceId))?.words ?? [];
      const cues = toCues(words, voice?.words?.length ? undefined : keep ?? undefined, most);
      if (cues.length) {
        const ass = name(`make-captions-${n}.ass`);
        await fs.writeFile(path.join(dir, ass), captionFile(size, cues));
        graph.push(`[${video}]ass=${ass}:fontsdir=.[cap]`);
        video = "cap";
      }
    }
    const fades = [
      ...(fadeIn ? [`fade=t=in:st=0:d=${FADE}:c=0x0a0a0a`] : []),
      ...(fadeOut && dur > FADE * 2 ? [`fade=t=out:st=${(dur - FADE).toFixed(3)}:d=${FADE}:c=0x0a0a0a`] : []),
    ];
    if (fades.length) {
      graph.push(`[${video}]${fades.join(",")}[faded]`);
      video = "faded";
    }

    // Sound: every piece gets a track, so pieces join without losing sync.
    const norm = "aresample=48000,aformat=channel_layouts=stereo";
    const hasOriginal = info.audio > 0;
    let sound: string;
    if (voice) {
      inputs.push("-i", file(sourceId, "voice.webm"));
      const delay = Math.round(voice.start * 1000);
      graph.push(`[1:a:0]${norm},adelay=${delay}:all=1,apad[vo]`);
      if (opts.audio === "both" && hasOriginal) {
        graph.push(`[0:a:0]${norm},volume=0.25,apad[under]`);
        graph.push("[vo][under]amix=inputs=2:duration=first:normalize=0[mixed]");
        sound = "mixed";
      } else {
        sound = "vo";
      }
    } else if (hasOriginal) {
      graph.push(`[0:a:0]${norm},apad[orig]`);
      sound = "orig";
    } else {
      inputs.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
      sound = "1:a";
    }
    const afades = [
      ...(fadeIn ? [`afade=t=in:st=0:d=${FADE}`] : []),
      ...(fadeOut && dur > FADE * 2 ? [`afade=t=out:st=${(dur - FADE).toFixed(3)}:d=${FADE}`] : []),
    ];
    if (afades.length) {
      graph.push(`[${sound}]${afades.join(",")}[soundout]`);
      sound = "soundout";
    }
    const script = name(`make-${n}.filter`);
    await fs.writeFile(path.join(dir, script), graph.join(";"));
    const out = name(`make-${n}.mp4`);
    await run("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error", ...inputs, "-/filter_complex", script,
      "-map", `[${video}]`, "-map", sound.includes(":") ? sound : `[${sound}]`, "-t", dur.toFixed(3), ...ENCODE(opts.small), out,
    ], dir);
    return out;
  };

  const cardSegment = async (n: number, first: string, second: string, seconds: number) => {
    const title = assText(first);
    const sub = assText(second);
    const big = Math.round((opts.format === "wide" ? 84 : 76) * size.unit);
    const small = Math.round(38 * size.unit);
    const side = Math.round(W * 0.08);
    const ass = name(`make-card-${n}.ass`);
    await fs.writeFile(path.join(dir, ass), assFile(W, H,
      [
        `Style: Title,${FONT},${big},&H00F2F2F0,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,5,${side},${side},0,1`,
        `Style: Sub,${FONT},${small},&H00A0A0A0,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,${side},${side},0,1`,
      ],
      [
        ...(title ? [`Dialogue: 0,0:00:00.00,1:00:00.00,Title,,0,0,0,,{\\pos(${W / 2},${Math.round(H * (sub ? 0.46 : 0.5))})}${title}`] : []),
        ...(sub ? [`Dialogue: 0,0:00:00.00,1:00:00.00,Sub,,0,0,0,,{\\pos(${W / 2},${Math.round(H * (title ? 0.58 : 0.5))})}${sub}`] : []),
      ],
    ));
    const out = name(`make-${n}.mp4`);
    await run("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-t", String(seconds), "-i", `color=c=0x0a0a0a:s=${W}x${H}:r=30`,
      "-f", "lavfi", "-t", String(seconds), "-i", "anullsrc=r=48000:cl=stereo",
      "-vf", `ass=${ass}:fontsdir=.,fade=t=in:st=0:d=${FADE}:c=0x0a0a0a,fade=t=out:st=${seconds - FADE}:d=${FADE}:c=0x0a0a0a,setsar=1,format=yuv420p`,
      ...ENCODE(opts.small), out,
    ], dir);
    return out;
  };

  const hasIntro = opts.intro && !!(assText(opts.introTitle) || assText(opts.introSubtitle));
  const hasEnd = opts.endCard && !!(assText(opts.endTitle) || assText(opts.endLink));
  const parts: string[] = [];
  let n = 0;
  if (hasIntro) parts.push(await cardSegment(n++, opts.introTitle, opts.introSubtitle, INTRO_SECONDS));
  const last = opts.clips.length;
  parts.push(await segment(n++, id, opts.edited, true, hasIntro, hasEnd && last === 0));
  for (let i = 0; i < last; i++) {
    const clip = await readMeta(opts.clips[i]);
    if (clip?.status !== "ready") throw new PermanentError("One of the added clips isn't available any more.");
    parts.push(await segment(n++, opts.clips[i], clip.clean.status === "ready" && opts.edited, false, false, hasEnd && i === last - 1));
  }
  if (hasEnd) parts.push(await cardSegment(n++, opts.endTitle, opts.endLink, END_SECONDS));

  const list = name("make-parts.txt");
  await fs.writeFile(path.join(dir, list), parts.map((p) => `file '${p}'`).join("\n"));
  const out = madeFile(opts.format);
  const tmp = name("make.tmp.mp4");
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", tmp], dir);
  await fs.rename(path.join(dir, tmp), file(id, out));
  for (const f of temp) await fs.rm(path.join(dir, f), { force: true });
  const made = await inspect(file(id, out));
  await writeMade(id, { status: "ready", options: opts, duration: made.duration });
}
