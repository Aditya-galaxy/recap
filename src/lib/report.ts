import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { polishSentence, polishStep, polishTitle } from "./ai";
import { esc, group, screenChanges, sentences, shotTimes, still, tidy, type Sentence } from "./guide";
import { file, readMeta, readTranscript, videoDir } from "./store";

/**
 * A bug report from a recording of someone reproducing a problem while describing it: steps to reproduce
 * (with screenshots), what should have happened, what happened instead (with the screen at that moment),
 * and the environment. Built from the transcript and the video, on this computer.
 */

export interface ReportStep {
  t: number;
  text: string;
  image: string;
  spoken?: string;
}

export interface Report {
  status: "making" | "polishing" | "ready" | "error";
  error?: string;
  title: string;
  steps: ReportStep[];
  expected: string;
  actual: string;
  /** The screen while the problem is described. */
  actualImage?: string;
  actualT?: number;
  environment: string[];
  updatedAt: string;
  polished?: boolean;
  spoken?: { title: string; expected: string; actual: string };
  progress?: number;
}

const REPORT_FILE = "report.json";
const IMAGE_DIR = "report";
export const REPORT_IMAGE_RE = /^(step-\d{3}|actual)-[a-z0-9]{6}\.jpg$/;
export const reportImagePath = (id: string, name: string) => path.join(videoDir(id), IMAGE_DIR, name);

export async function readReport(id: string): Promise<Report | null> {
  try {
    return JSON.parse(await fs.readFile(file(id, REPORT_FILE), "utf8"));
  } catch {
    return null;
  }
}

export async function writeReport(id: string, r: Report) {
  const p = file(id, REPORT_FILE);
  await fs.writeFile(p + ".tmp", JSON.stringify(r));
  await fs.rename(p + ".tmp", p);
}

// What people say when they describe a bug. "Expected" talks about what should happen; "actual" about what did.
const EXPECTED = /\b(should(?:n't| not)?|supposed to|expected|expecting|expect|ought to|meant to|normally)\b/i;
const ACTUAL =
  /\b(but|instead|error|errors|fails?|failed|failing|nothing happens|doesn't|does not|didn't|did not|won't|isn't|can't|cannot|crash(?:es|ed)?|broken|stuck|blank|freez(?:e|es|ing)|hangs?|spinn(?:er|ing)|not working|doesn't work|wrong|disappears?|missing|404|500|exception|timed? ?out)\b/i;
const INTRO = /\b(found a bug|here's a bug|there's a bug|reporting|let me show you|i'll show you|this is a bug|bug where|issue where|problem where)\b/i;
const SPLIT = /\s*(?:,\s*)?\b(but instead|but|instead)\b,?\s*/i;

type Kind = "step" | "expected" | "actual" | "intro";
type Part = { kind: Kind; text: string; start: number; end: number; sentence: Sentence };

/** Sorts what was said into steps, expectations and the actual behavior. "It should save, but I get an error" is split in two. */
export function classify(sents: Sentence[]): Part[] {
  const parts: Part[] = [];
  for (const s of sents) {
    const text = s.words.map((w) => w.text).join(" ").replace(/\s+([,.?!;:])/g, "$1");
    const base = { start: s.start, end: s.end, sentence: s };
    const m = text.match(SPLIT);
    if (m && m.index && EXPECTED.test(text.slice(0, m.index))) {
      parts.push({ ...base, kind: "expected", text: text.slice(0, m.index) });
      parts.push({ ...base, kind: "actual", text: text.slice(m.index + m[0].length) });
      continue;
    }
    const kind: Kind = INTRO.test(text) ? "intro" : EXPECTED.test(text) ? "expected" : ACTUAL.test(text) ? "actual" : "step";
    parts.push({ ...base, kind, text });
  }
  return parts;
}

function environment(meta: { createdAt: string; width?: number; height?: number }) {
  const platform = { darwin: "macOS", win32: "Windows", linux: "Linux" }[process.platform as string] ?? process.platform;
  const env = [`Recorded ${new Date(meta.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`];
  // In the desktop app the engine runs on the computer that recorded, so its OS is the reporter's.
  if (process.env.RECAP_LOCAL_TOKEN) env.push(`${platform} ${os.release()}`);
  if (meta.width && meta.height) env.push(`Screen ${meta.width}×${meta.height}`);
  return env;
}

/** A useful default title: the error message and the action that triggers it, or the problem as said. */
export function bugTitle(actual: string, lastStep: string) {
  if (!actual) return "";
  const quote = actual.match(/["\u201c]([^"\u201d]{3,80})["\u201d]/)?.[1]?.replace(/[.!?]+$/, "");
  const action = lastStep.match(/\b(click|tap|press|choose|select|open|submit|save|upload|send)\w*\s+(?:on\s+)?(?:the\s+)?([^.,;]{2,40})/i);
  const ing = (v: string) => ({ click: "clicking", tap: "tapping", press: "pressing", choose: "choosing", select: "selecting", open: "opening", submit: "submitting", save: "saving", upload: "uploading", send: "sending" })[v.toLowerCase()] ?? v;
  if (quote) return `"${quote}" error${action ? ` after ${ing(action[1])} ${action[2].trim()}` : ""}`;
  const t = actual.replace(/^(and|then|so|now|instead|but)[,\s]+/i, "").replace(/[.?!]+$/, "").slice(0, 90);
  return t[0].toUpperCase() + t.slice(1);
}

export async function makeReport(id: string) {
  const meta = await readMeta(id);
  if (!meta) throw new Error("video not found");
  const transcript = await readTranscript(id);
  const video = file(id, "video.mp4");
  const duration = meta.duration ?? 0;
  const changes = await screenChanges(video);
  const parts = classify(sentences(transcript?.words ?? []));

  const stepSents = parts.filter((p) => p.kind === "step").map((p) => ({ ...p.sentence, words: p.sentence.words }));
  const groups = group(stepSents, changes).slice(0, 40);
  const plan = groups.map((g) => ({
    start: g[0].start,
    end: g[g.length - 1].end,
    text: g.map((s) => tidy(s.words.map((w) => w.text).join(" "))).filter(Boolean).join(" "),
  }));
  const shots = shotTimes(plan, changes, duration);
  const expected = parts.filter((p) => p.kind === "expected").map((p) => tidy(p.text)).filter(Boolean).join(" ");
  const actualParts = parts.filter((p) => p.kind === "actual");
  const actual = actualParts.map((p) => tidy(p.text)).filter(Boolean).join(" ");

  const dir = path.join(videoDir(id), IMAGE_DIR);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const tag = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  const steps: ReportStep[] = [];
  for (let i = 0; i < plan.length; i++) {
    const image = `step-${String(i + 1).padStart(3, "0")}-${tag}.jpg`;
    await still(video, shots[i], path.join(dir, image));
    steps.push({ t: Number(shots[i].toFixed(2)), text: plan[i].text, image });
  }
  // The problem on screen: as it's being described (a little in, so an error that appears has appeared).
  let actualImage: string | undefined;
  let actualT: number | undefined;
  if (actualParts.length) {
    const a = actualParts[0];
    actualT = Number(Math.max(0, Math.min(a.start + Math.min(1.5, (a.end - a.start) / 2), duration - 0.1)).toFixed(2));
    actualImage = `actual-${tag}.jpg`;
    await still(video, actualT, path.join(dir, actualImage));
  }

  const title = bugTitle(actual, plan.at(-1)?.text ?? "") || meta.title;
  await writeReport(id, {
    status: "ready",
    title,
    steps,
    expected,
    actual,
    actualImage,
    actualT,
    environment: environment(meta),
    updatedAt: new Date().toISOString(),
  });
  return steps.length;
}

/** Rewrites steps, expected/actual and the title with the on-device model; the spoken text is kept for undo. */
export async function polishReport(id: string) {
  const r = await readReport(id);
  if (!r || r.status !== "polishing") return;
  const steps = r.steps.map((s) => ({ ...s, spoken: s.spoken ?? s.text }));
  const spoken = r.spoken ?? { title: r.title, expected: r.expected, actual: r.actual };
  for (let i = 0; i < steps.length; i++) {
    steps[i].text = await polishStep(steps[i].spoken!);
    await writeReport(id, { ...r, steps, progress: i + 1 });
  }
  const expected = spoken.expected ? await polishSentence(spoken.expected, "expected") : "";
  const actual = spoken.actual ? await polishSentence(spoken.actual, "actual") : "";
  const title = actual ? await polishTitle(spoken.title, [actual], "bug") : spoken.title;
  await writeReport(id, { ...r, status: "ready", title, steps, expected, actual, spoken, polished: true, progress: undefined, error: undefined, updatedAt: new Date().toISOString() });
}

export function reportMarkdown(r: Report, videoName?: string) {
  const lines = [`## ${r.title}`, "", "**Steps to reproduce**"];
  r.steps.forEach((s, i) => lines.push(`${i + 1}. ${s.text || `Step ${i + 1}`}`));
  lines.push("", "**Expected**", r.expected || "_(not stated)_", "", "**Actual**", r.actual || "_(not stated)_", "", "**Environment**");
  for (const e of r.environment) lines.push(`- ${e}`);
  if (videoName) lines.push(`- Recording: ${videoName}`);
  lines.push("", "_Report made with Recap from a screen recording._");
  return lines.join("\n") + "\n";
}

export async function reportHtml(id: string, r: Report) {
  const img = async (name?: string, alt = "") => {
    if (!name) return "";
    const data = await fs.readFile(reportImagePath(id, name)).catch(() => null);
    return data ? `<img src="data:image/jpeg;base64,${data.toString("base64")}" alt="${esc(alt)}">` : "";
  };
  const steps = await Promise.all(r.steps.map(async (s, i) => `<li><p>${esc(s.text || `Step ${i + 1}`)}</p>${await img(s.image, `Step ${i + 1}`)}</li>`));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.title)}</title>
<style>
body{font:16px/1.6 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;background:#fff;max-width:820px;margin:48px auto;padding:0 20px}
h1{font-size:28px;line-height:1.25;letter-spacing:-.02em;margin:0 0 28px}h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:#666;margin:36px 0 10px}
ol{padding-left:1.4em}li{margin:0 0 28px}li p{margin:0 0 10px}img{display:block;max-width:100%;border:1px solid #e3e3e3;border-radius:10px}
.box{border-left:4px solid #ddd;padding:2px 0 2px 16px}.actual{border-color:#e5484d}
ul.env{color:#555;padding-left:1.2em}.foot{color:#999;font-size:13px;margin-top:40px}
@media print{body{margin:0}li{break-inside:avoid}}
</style></head><body>
<h1>${esc(r.title)}</h1>
<h2>Steps to reproduce</h2><ol>${steps.join("\n")}</ol>
<h2>Expected</h2><p class="box">${esc(r.expected || "(not stated)")}</p>
<h2>Actual</h2><p class="box actual">${esc(r.actual || "(not stated)")}</p>${await img(r.actualImage, "What happened")}
<h2>Environment</h2><ul class="env">${r.environment.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
<p class="foot">Report made with Recap from a screen recording.</p>
</body></html>`;
}
