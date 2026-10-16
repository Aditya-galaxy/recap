import "server-only";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { polishStep, polishTitle } from "./ai";
import { config } from "./config";
import { file, readMeta, readTranscript, videoDir } from "./store";
import type { Word } from "./types";

/**
 * Turns a narrated screen recording into a step-by-step guide: what was said becomes the steps, and a
 * screenshot is taken at the moment of each action (just before the screen changes). All local: ffmpeg
 * for scene changes and stills, the existing transcript for the words. No AI service involved.
 */

export interface GuideStep {
  /** Seconds into the original recording. */
  t: number;
  text: string;
  /** File name inside the video's guide/ folder. */
  image: string;
  /** The step as it was spoken, kept after an AI polish so it can be undone. */
  spoken?: string;
}

export interface Guide {
  status: "making" | "polishing" | "ready" | "error";
  error?: string;
  title: string;
  steps: GuideStep[];
  updatedAt: string;
  /** Rewritten by the on-device model; spokenTitle and each step's spoken text allow undo. */
  polished?: boolean;
  spokenTitle?: string;
  /** While polishing: steps done so far. */
  progress?: number;
}

const GUIDE_FILE = "guide.json";
const IMAGE_DIR = "guide";
const MAX_STEPS = 60;
export const IMAGE_RE = /^step-\d{3}-[a-z0-9]{6}\.jpg$/;

export async function readGuide(id: string): Promise<Guide | null> {
  try {
    return JSON.parse(await fs.readFile(file(id, GUIDE_FILE), "utf8"));
  } catch {
    return null;
  }
}

export async function writeGuide(id: string, g: Guide) {
  const p = file(id, GUIDE_FILE);
  await fs.writeFile(p + ".tmp", JSON.stringify(g));
  await fs.rename(p + ".tmp", p);
}

export const imagePath = (id: string, name: string) => path.join(videoDir(id), IMAGE_DIR, name);

export function ffmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(config.ffmpegBin, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-500)}`))));
  });
}

/** Moments the screen visibly changes (a click opening a page, a menu, a new window). */
export async function screenChanges(video: string): Promise<number[]> {
  // Small, 5 fps frames are plenty to notice UI changes and keep this quick on long recordings. A screen
  // change only redraws part of the frame, so its score is small (a menu or page change is ~0.008–0.02);
  // the pointer moving or compression noise stays under ~0.001.
  const log = await ffmpeg([
    "-hide_banner", "-nostats", "-i", video, "-an",
    "-vf", "fps=5,scale=480:-2,select='gt(scene,0.004)',showinfo", "-f", "null", "-",
  ]);
  const times = [...log.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
  // One action often changes the screen over several frames: keep the first of each burst.
  return times.filter((t, i) => i === 0 || t - times[i - 1] > 0.6);
}

export type Sentence = { start: number; end: number; words: Word[] };

export function sentences(words: Word[]): Sentence[] {
  const spoken = words.filter((w) => !w.filler && w.text.trim());
  const out: Sentence[] = [];
  let cur: Word[] = [];
  spoken.forEach((w, i) => {
    cur.push(w);
    const next = spoken[i + 1];
    const endsSentence = /[.?!]["')\]]?$/.test(w.text.trim());
    // A long pause only ends a sentence if what follows starts like one: Whisper sometimes stamps the last word of a
    // phrase late ("display … name."), which looks like a pause in the middle of a sentence.
    const longGap = next && next.start - w.end > 1.2 && /^["'(]?[A-Z]/.test(next.text.trim());
    if (!next || endsSentence || longGap) {
      out.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur });
      cur = [];
    }
  });
  return out;
}

// Spoken lead-ins that don't belong in written instructions.
const LEAD_IN = /^(?:(?:so|okay|ok|alright|all right|and|right|well|now then)[,.]?\s+)+/i;

export function tidy(text: string) {
  let s = text.replace(/\s+/g, " ").replace(/\s+([,.?!;:])/g, "$1").trim();
  s = s.replace(LEAD_IN, "");
  s = s.replace(/^[,.;:\s]+/, "");
  if (!s) return "";
  s = s[0].toUpperCase() + s.slice(1);
  if (!/[.?!]["')\]\u201d]?$/.test(s)) s += ".";
  return s;
}

/** Group sentences into steps: a new step whenever the screen changed, and at most 3 sentences per step. */
export function group(sents: Sentence[], changes: number[]) {
  const steps: Sentence[][] = [];
  let cur: Sentence[] = [];
  for (const s of sents) {
    const changed = cur.length > 0 && changes.some((c) => c > cur[0].start + 0.3 && c <= s.start + 0.2);
    if (cur.length && (changed || cur.length >= 3)) {
      steps.push(cur);
      cur = [];
    }
    cur.push(s);
  }
  if (cur.length) steps.push(cur);
  return steps;
}

/** One still from the video, sized for documents. */
export function still(video: string, t: number, out: string) {
  return ffmpeg(["-hide_banner", "-loglevel", "error", "-ss", t.toFixed(2), "-i", video, "-frames:v", "1", "-vf", "scale='min(1600,iw)':-2", "-q:v", "3", "-y", out]);
}

/** When to take each step's screenshot: just before the first screen change while (or right after) it's spoken. */
export function shotTimes(plan: { start: number; end: number }[], changes: number[], duration: number) {
  return plan.map((p, i) => {
    const until = plan[i + 1]?.start ?? duration;
    const c = changes.find((t) => t > p.start + 0.3 && t <= until + 0.3);
    const t = c !== undefined ? c - 0.25 : p.end;
    return Math.max(0, Math.min(t, duration - 0.1));
  });
}

export async function makeGuide(id: string) {
  const meta = await readMeta(id);
  if (!meta) throw new Error("video not found");
  const transcript = await readTranscript(id);
  const video = file(id, "video.mp4");
  const duration = meta.duration ?? 0;
  const changes = await screenChanges(video);

  // Steps from narration; a recording without speech gets one step per screen change to describe by hand.
  const sents = sentences(transcript?.words ?? []);
  let plan: { start: number; end: number; text: string }[] = sents.length
    ? group(sents, changes).map((g) => ({
        start: g[0].start,
        end: g[g.length - 1].end,
        text: g.map((s) => tidy(s.words.map((w) => w.text).join(" "))).filter(Boolean).join(" "),
      }))
    : [0, ...changes].map((t, i, a) => ({ start: t, end: a[i + 1] ?? duration, text: "" }));
  plan = plan.filter((p) => p.text || !sents.length).slice(0, MAX_STEPS);

  // Screenshot at the action, so the pointer is still on what to click. No change: the screen as the sentence ends.
  const shots = shotTimes(plan, changes, duration);

  const dir = path.join(videoDir(id), IMAGE_DIR);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const tag = Math.random().toString(36).slice(2, 8).padEnd(6, "0"); // new names each time, so nothing serves a stale image
  const steps: GuideStep[] = [];
  for (let i = 0; i < plan.length; i++) {
    const image = `step-${String(i + 1).padStart(3, "0")}-${tag}.jpg`;
    await still(video, shots[i], path.join(dir, image));
    steps.push({ t: Number(shots[i].toFixed(2)), text: plan[i].text, image });
  }
  await writeGuide(id, { status: "ready", title: meta.title, steps, updatedAt: new Date().toISOString() });
  return steps.length;
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** One self-contained HTML file (images inlined): opens anywhere, imports into Notion/Docs/Confluence, prints to PDF. */
export async function guideHtml(id: string, g: Guide) {
  const items = await Promise.all(
    g.steps.map(async (s, i) => {
      const data = await fs.readFile(imagePath(id, s.image)).catch(() => null);
      const img = data ? `<img src="data:image/jpeg;base64,${data.toString("base64")}" alt="Step ${i + 1}">` : "";
      return `<li><p>${esc(s.text || `Step ${i + 1}`)}</p>${img}</li>`;
    }),
  );
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(g.title)}</title>
<style>
body{font:16px/1.6 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;background:#fff;max-width:820px;margin:48px auto;padding:0 20px}
h1{font-size:30px;line-height:1.2;letter-spacing:-.02em;margin:0 0 6px}
.meta{color:#777;font-size:13px;margin:0 0 36px}
ol{padding-left:1.4em}li{margin:0 0 40px}li::marker{font-weight:600}
li p{margin:0 0 12px}img{display:block;max-width:100%;border:1px solid #e3e3e3;border-radius:10px}
@media print{body{margin:0}li{break-inside:avoid}}
</style></head><body>
<h1>${esc(g.title)}</h1>
<p class="meta">${g.steps.length} steps · made with Recap</p>
<ol>
${items.join("\n")}
</ol>
</body></html>`;
}

export function guideMarkdown(g: Guide) {
  return `# ${g.title}\n\n${g.steps.map((s, i) => `${i + 1}. ${s.text || `Step ${i + 1}`}`).join("\n")}\n`;
}

/** Rewrites each step (and the title) with the on-device model. The spoken text is kept for undo. */
export async function polishGuide(id: string) {
  const g = await readGuide(id);
  if (!g || g.status !== "polishing") return;
  const steps = g.steps.map((s) => ({ ...s, spoken: s.spoken ?? s.text }));
  for (let i = 0; i < steps.length; i++) {
    steps[i].text = await polishStep(steps[i].spoken!);
    await writeGuide(id, { ...g, steps, progress: i + 1 });
  }
  const spokenTitle = g.spokenTitle ?? g.title;
  const title = await polishTitle(spokenTitle, steps.map((s) => s.text));
  await writeGuide(id, { ...g, status: "ready", title, spokenTitle, steps, polished: true, progress: undefined, error: undefined, updatedAt: new Date().toISOString() });
}
