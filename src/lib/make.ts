import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { toCues } from "./captions";
import { inspect, PermanentError, readKeep, run } from "./pipeline";
import { file, readMeta, readTranscript } from "./store";

/**
 * "Make it a video": turns a recording or its edit into a finished video for sharing: the shape a platform
 * wants, captions burned in (most social video plays muted) and an end card. The source is never changed.
 */

export type MakeFormat = "wide" | "square" | "vertical";
export type MakeOptions = {
  format: MakeFormat;
  captions: boolean;
  endCard: boolean;
  endTitle: string;
  endLink: string;
  /** Smaller file for email and chat: 720p and stronger compression. */
  small: boolean;
  /** Use the saved edit rather than the original. */
  edited: boolean;
};
export type Made = { status: "rendering" | "ready" | "error"; options: MakeOptions; error?: string; duration?: number };

const END_SECONDS = 3.5;
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

export async function makeVideo(id: string, opts: MakeOptions) {
  const meta = await readMeta(id);
  if (!meta?.duration) throw new PermanentError("Video isn't ready yet.");
  const keep = opts.edited ? await readKeep(id) : null;
  const source = file(id, keep ? "clean.mp4" : "video.mp4");
  const info = await inspect(source);
  if (!info.duration || !info.width || !info.height) throw new PermanentError("That video can't be read.");

  const [fullW, fullH] = DIMENSIONS[opts.format];
  const scale = opts.small ? 2 / 3 : 1;
  const W = Math.round((fullW * scale) / 2) * 2;
  const H = Math.round((fullH * scale) / 2) * 2;
  const unit = Math.min(W, H) / 1080;

  // Everything is written next to the video and ffmpeg runs from there: filter strings can then use plain
  // relative names, with no escaping for spaces, quotes or a drive letter in the person's folder path.
  const dir = path.dirname(source);
  await fs.copyFile(path.join(process.cwd(), "public", "fonts", FONT_FILE), path.join(dir, FONT_FILE));

  const fits = Math.abs(info.width / info.height - W / H) < 0.01;
  const graph = fits
    ? [`[0:v]scale=${W}:${H}:flags=lanczos,setsar=1,fps=30,format=yuv420p[base]`]
    : [
        // A different shape: the whole picture stays visible, over a blurred copy of itself.
        "[0:v]split=2[bgsrc][fgsrc]",
        `[bgsrc]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:2,eq=brightness=-0.12[bg]`,
        `[fgsrc]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1[fg]`,
        "[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30,format=yuv420p[base]",
      ];
  let video = "base";

  if (opts.captions) {
    const t = await readTranscript(id);
    // Short lines: a caption has to be read at a glance, and a tall video has less width.
    const cues = toCues(t?.words ?? [], keep ?? undefined, opts.format === "vertical" ? 5 : 8);
    if (cues.length) {
      const size = Math.round((opts.format === "vertical" ? 62 : 52) * unit);
      const margin = Math.round(H * (opts.format === "vertical" ? 0.16 : 0.07));
      const side = Math.round(W * 0.07);
      await fs.writeFile(file(id, "make-captions.ass"), assFile(W, H,
        [`Style: Cap,${FONT},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H99000000,1,0,0,0,100,100,0,0,3,${Math.round(14 * unit)},0,2,${side},${side},${margin},1`],
        cues.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(Math.max(c.end, c.start + 0.6))},Cap,,0,0,0,,${assText(c.text)}`),
      ));
      graph.push(`[base]ass=make-captions.ass:fontsdir=.[cap]`);
      video = "cap";
    }
  }

  const audio = info.audio > 0;
  const inputs = ["-i", source];
  let audioOut = audio ? "0:a:0" : "";
  const title = assText(opts.endTitle);
  const link = assText(opts.endLink);
  // A card needs something on it, and the video has to be long enough to fade out of.
  const card = opts.endCard && (title || link) && info.duration > FADE + 0.2;
  if (card) {
    const big = Math.round((opts.format === "wide" ? 84 : 76) * unit);
    const small = Math.round(38 * unit);
    const side = Math.round(W * 0.08);
    await fs.writeFile(file(id, "make-end.ass"), assFile(W, H,
      [
        `Style: Title,${FONT},${big},&H00F2F2F0,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,5,${side},${side},0,1`,
        `Style: Link,${FONT},${small},&H00A0A0A0,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,${side},${side},0,1`,
      ],
      [
        ...(title ? [`Dialogue: 0,0:00:00.00,1:00:00.00,Title,,0,0,0,,{\\pos(${W / 2},${Math.round(H * (link ? 0.46 : 0.5))})}${title}`] : []),
        ...(link ? [`Dialogue: 0,0:00:00.00,1:00:00.00,Link,,0,0,0,,{\\pos(${W / 2},${Math.round(H * (title ? 0.58 : 0.5))})}${link}`] : []),
      ],
    ));
    inputs.push("-f", "lavfi", "-t", String(END_SECONDS), "-i", `color=c=0x0a0a0a:s=${W}x${H}:r=30`);
    graph.push(`[1:v]ass=make-end.ass:fontsdir=.,setsar=1,format=yuv420p,settb=AVTB[end]`);
    graph.push(`[${video}]settb=AVTB[main]`);
    graph.push(`[main][end]xfade=transition=fade:duration=${FADE}:offset=${(info.duration - FADE).toFixed(3)}[v]`);
    video = "v";
    if (audio) {
      inputs.push("-f", "lavfi", "-t", String(END_SECONDS), "-i", "anullsrc=r=48000:cl=stereo");
      graph.push(`[0:a:0]aresample=48000,aformat=channel_layouts=stereo[a0]`);
      graph.push(`[a0][2:a]acrossfade=d=${FADE}[a]`);
      audioOut = "[a]";
    }
  }

  await fs.writeFile(file(id, "make.filter"), graph.join(";"));
  const out = madeFile(opts.format);
  const tmp = "make.tmp.mp4";
  await run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error", ...inputs, "-/filter_complex", "make.filter",
    "-map", `[${video}]`, ...(audioOut ? ["-map", audioOut] : []),
    "-c:v", "libx264", "-preset", "faster", "-crf", opts.small ? "27" : "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", opts.small ? "96k" : "160k", "-movflags", "+faststart", tmp,
  ], dir);
  await fs.rename(file(id, tmp), file(id, out));
  for (const f of ["make.filter", "make-captions.ass", "make-end.ass", FONT_FILE]) await fs.rm(file(id, f), { force: true });
  const made = await inspect(file(id, out));
  await writeMade(id, { status: "ready", options: opts, duration: made.duration });
}
