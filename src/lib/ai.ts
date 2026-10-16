import "server-only";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "./config";

/**
 * Optional on-device AI: a small instruct model (Qwen2.5 1.5B, Apache-2.0) run by llama.cpp. Nothing is sent
 * anywhere; the model is downloaded once, on request, and checked against its published SHA-256.
 */
export const MODEL = {
  name: "Qwen2.5 1.5B Instruct",
  url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
  sha256: "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e",
  bytes: 1117320736,
};

export type AiStatus = {
  /** llama.cpp is bundled with this install (the desktop app); servers without it hide the feature. */
  available: boolean;
  model: "none" | "downloading" | "ready" | "error";
  progress: number;
  error?: string;
  bytes: number;
};

const g = globalThis as unknown as { __recapAi?: { model: AiStatus["model"]; progress: number; error?: string } };
const state = () => (g.__recapAi ??= { model: "none", progress: 0 });

async function exists(p: string) {
  return fs.access(p).then(() => true, () => false);
}

async function binaryAvailable() {
  // A bare command name (servers) means "on PATH": only the desktop app passes a real path.
  return path.isAbsolute(config.llamaBin) ? exists(config.llamaBin) : false;
}

export async function aiStatus(): Promise<AiStatus> {
  const s = state();
  // The file on disk is the truth: someone may have deleted it to free space.
  if (s.model !== "downloading") {
    const onDisk = await exists(config.polishModel);
    if (onDisk) Object.assign(s, { model: "ready", error: undefined });
    else if (s.model === "ready") Object.assign(s, { model: "none", progress: 0 });
  }
  return { available: await binaryAvailable(), model: s.model, progress: s.progress, error: s.error, bytes: MODEL.bytes };
}

/** Starts the one-time model download in the background. Safe to call again. */
export function downloadModel() {
  const s = state();
  if (s.model === "downloading" || s.model === "ready") return;
  Object.assign(s, { model: "downloading", progress: 0, error: undefined });
  const tmp = config.polishModel + ".part";
  (async () => {
    await fs.mkdir(path.dirname(config.polishModel), { recursive: true });
    const res = await fetch(MODEL.url);
    if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
    const hash = createHash("sha256");
    let got = 0;
    const counter = new (await import("node:stream")).Transform({
      transform(chunk: Buffer, _e, cb) {
        got += chunk.length;
        hash.update(chunk);
        s.progress = Math.min(0.999, got / MODEL.bytes);
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), counter, createWriteStream(tmp));
    if (hash.digest("hex") !== MODEL.sha256) throw new Error("the downloaded model didn't match its checksum");
    await fs.rename(tmp, config.polishModel);
    Object.assign(s, { model: "ready", progress: 1 });
  })().catch(async (err) => {
    await fs.rm(tmp, { force: true }).catch(() => {});
    const offline = /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT/i.test(String(err?.cause ?? err));
    Object.assign(s, { model: "error", progress: 0, error: offline ? "Couldn't reach the internet to download the AI model. Try again when you're online." : String(err.message ?? err) });
  });
}

export async function removeModel() {
  await fs.rm(config.polishModel, { force: true });
  Object.assign(state(), { model: "none", progress: 0, error: undefined });
}

const chat = (msgs: [string, string][]) => msgs.map(([r, c]) => `<|im_start|>${r}\n${c}<|im_end|>\n`).join("") + "<|im_start|>assistant\n";

/** One constrained completion; returns the parsed JSON the schema describes. */
function complete<T>(msgs: [string, string][], schema: object, maxTokens: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const p = spawn(
      config.llamaBin,
      ["-m", config.polishModel, "-p", chat(msgs), "-n", String(maxTokens), "--temp", "0.1", "--seed", "1",
        "-j", JSON.stringify(schema), "--no-display-prompt", "-no-cnv", "-c", "4096"],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`the AI model stopped (${code}): ${err.slice(-300)}`));
      const a = out.indexOf("{");
      const b = out.lastIndexOf("}");
      try {
        resolve(JSON.parse(out.slice(a, b + 1)));
      } catch {
        reject(new Error("the AI model gave an unreadable answer"));
      }
    });
  });
}

const STEP_SYSTEM =
  "You rewrite one step of a how-to guide. The guide was made from someone talking while recording their screen. " +
  "Write the step as a short written instruction that starts with a verb. Capitalize the names of buttons, tabs, menus and pages. " +
  "Drop filler and chit-chat. Use only what this step says: never add buttons, names or details. " +
  'If the step only introduces the task, write "Start here." followed by what the guide shows. ' +
  'If the step only wraps up (like "That\'s it"), describe the result if it is stated, otherwise write "Done."';

// Worked examples: a small model follows these far better than rules alone.
const SHOTS: [string, string][] = [
  ["Okay so first you, um, go to the settings page up here.", "Go to the Settings page."],
  ["Then click on billing.", "Click Billing."],
  ["Then there's this export button, you click that and pick CSV.", "Click Export and choose CSV."],
  ["So today I'm gonna show you how to reset a password.", "Start here. This guide shows how to reset a password."],
  ["And that's it, the file is saved to your downloads.", "The file is saved to your Downloads folder."],
  ["That's it.", "Done."],
];

/**
 * Rewrites one spoken step as a written instruction. Each step is rewritten on its own: given the whole guide,
 * a small model copies other steps' content into this one, and screenshots would no longer match.
 */
export async function polishStep(text: string): Promise<string> {
  if (!text.trim()) return text;
  const msgs: [string, string][] = [["system", STEP_SYSTEM]];
  for (const [a, b] of SHOTS) msgs.push(["user", JSON.stringify({ step: a })], ["assistant", JSON.stringify({ text: b })]);
  msgs.push(["user", JSON.stringify({ step: text })]);
  const { text: out } = await complete<{ text: string }>(msgs, { type: "object", properties: { text: { type: "string", maxLength: 220 } }, required: ["text"] }, 120);
  const clean = (out ?? "").replace(/\s+/g, " ").trim();
  // Guard against a runaway or empty answer: keep what was said.
  return clean && clean.length <= text.length * 2.5 + 60 ? clean : text;
}

export async function polishTitle(current: string, steps: string[]): Promise<string> {
  const { title } = await complete<{ title: string }>(
    [["system", 'Write a short title for a how-to guide, under 8 words. Start with "How to". Use only what the steps say.'], ["user", steps.join("\n")]],
    { type: "object", properties: { title: { type: "string", maxLength: 70 } }, required: ["title"] },
    40,
  );
  const t = (title ?? "").split(/[:–—|]| - /)[0].replace(/\s+/g, " ").trim().replace(/[.]$/, "");
  return /^how to\b/i.test(t) && t.length >= 8 ? t : current;
}
