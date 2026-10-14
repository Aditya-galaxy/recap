import "server-only";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { config } from "./config";
import { remapSpan } from "./cuts";
import { db } from "./db";
import { readKeep } from "./pipeline";
import { exists, file, readMeta, readTranscript } from "./store";
import type { Range, Transcript } from "./types";

// Desktop app (local mode) ↔ Recap Cloud. The app connects with the device flow (see lib/device.ts on the
// cloud side), keeps the resulting API token in the library folder (owner-only file), and shares a video by
// uploading the finished mp4 with the transcript it already made, so the cloud server never runs whisper.

interface Link {
  url: string;
  token: string;
  email: string;
  name: string;
}

const linkFile = () => path.join(config.dataDir, "cloud.json");
const g = globalThis as unknown as {
  __recapPending?: { deviceCode: string; userCode: string; verifyUrl: string; expiresAt: number; url: string } | null;
  __recapShares?: Map<string, { sent: number; total: number; error?: string }>;
};
const shares = (g.__recapShares ??= new Map());

async function readLink(): Promise<Link | null> {
  try {
    return JSON.parse(await fs.readFile(linkFile(), "utf8"));
  } catch {
    return null;
  }
}

async function cloudFetch(url: string, init: RequestInit & { timeout?: number } = {}) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeout ?? 15_000) });
  } catch (err) {
    throw new Error(`Couldn't reach ${new URL(url).host}: ${(err as Error).message}`);
  }
}

export type LinkStatus =
  | { state: "connected"; url: string; email: string }
  | { state: "pending"; url: string; userCode: string; verifyUrl: string }
  | { state: "disconnected"; url: string; error?: string };

/** Current state; while a connection is pending this also polls the cloud once. */
export async function linkStatus(): Promise<LinkStatus> {
  const link = await readLink();
  if (link) return { state: "connected", url: link.url, email: link.email };
  const p = g.__recapPending;
  if (!p) return { state: "disconnected", url: config.cloudUrl };
  if (p.expiresAt < Date.now()) {
    g.__recapPending = null;
    return { state: "disconnected", url: p.url, error: "The code expired. Try again." };
  }
  const r = await cloudFetch(`${p.url}/api/device/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceCode: p.deviceCode }),
  });
  const d = await r.json().catch(() => ({}));
  if (d.status === "approved" && typeof d.token === "string") {
    const next: Link = { url: p.url, token: d.token, email: String(d.email ?? ""), name: String(d.name ?? "") };
    await fs.writeFile(linkFile(), JSON.stringify(next), { mode: 0o600 });
    g.__recapPending = null;
    return { state: "connected", url: next.url, email: next.email };
  }
  if (d.status === "denied" || d.status === "expired") {
    g.__recapPending = null;
    return { state: "disconnected", url: p.url, error: d.status === "denied" ? "The request was denied." : "The code expired. Try again." };
  }
  return { state: "pending", url: p.url, userCode: p.userCode, verifyUrl: p.verifyUrl };
}

export async function startLink(): Promise<LinkStatus> {
  const url = config.cloudUrl;
  const client = `Recap desktop (${{ darwin: "macOS", win32: "Windows", linux: "Linux" }[process.platform as string] ?? process.platform})`;
  const r = await cloudFetch(`${url}/api/device/code`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client }) });
  if (!r.ok) throw new Error(`Recap Cloud answered ${r.status}.`);
  const d = await r.json();
  g.__recapPending = { deviceCode: d.deviceCode, userCode: d.userCode, verifyUrl: d.verifyUrlComplete, expiresAt: Date.now() + d.expiresIn * 1000, url };
  return { state: "pending", url, userCode: d.userCode, verifyUrl: d.verifyUrlComplete };
}

/** Forget the link here and revoke the token on the cloud (best effort: it can also be revoked from cloud settings). */
export async function unlink() {
  g.__recapPending = null;
  const link = await readLink();
  await fs.rm(linkFile(), { force: true });
  if (link) await cloudFetch(`${link.url}/api/tokens/current`, { method: "DELETE", headers: { Authorization: `Bearer ${link.token}` } }).catch(() => {});
}

export const shareProgress = (id: string) => shares.get(id) ?? null;

export function cloudLinkOf(id: string) {
  return (db.prepare("SELECT cloud_url, cloud_version FROM videos WHERE id = ?").get(id) as { cloud_url: string | null; cloud_version: string | null } | undefined) ?? null;
}

/** The transcript on the cleaned timeline, so captions and the transcript line up with the cleaned video. */
function onCleanTimeline(t: Transcript, keep: Range[]): Transcript {
  const words = t.words.flatMap((w) => {
    const r = remapSpan(w, keep);
    return r ? [{ ...w, ...r }] : [];
  });
  const silences = t.silences.flatMap((s) => {
    const r = remapSpan(s, keep);
    return r ? [r] : [];
  });
  return { words, silences };
}

/**
 * Starts uploading a video (original, or the cleaned cut) to the connected cloud account. Runs in the
 * background; poll shareProgress(id). Resolves the cloud URL into the local DB when done.
 */
export async function share(id: string, version: "original" | "clean") {
  const link = await readLink();
  if (!link) throw new Error("Connect Recap Cloud first.");
  const meta = await readMeta(id);
  if (!meta || meta.status !== "ready") throw new Error("The video isn't ready yet.");
  if (shares.get(id) && !shares.get(id)!.error) throw new Error("Already sharing this video.");
  const media = file(id, version === "clean" ? "clean.mp4" : "video.mp4");
  if (!(await exists(media))) throw new Error(version === "clean" ? "Render the cleaned version first." : "Video file is missing.");

  let transcript = (await readTranscript(id)) ?? { words: [], silences: [] };
  if (version === "clean") {
    const keep = await readKeep(id);
    if (keep) transcript = onCleanTimeline(transcript, keep);
  }
  const head = Buffer.from(JSON.stringify(transcript));
  const size = (await fs.stat(media)).size;
  const progress = { sent: 0, total: head.length + size } as { sent: number; total: number; error?: string };
  shares.set(id, progress);

  async function* body() {
    yield head;
    progress.sent += head.length;
    for await (const chunk of createReadStream(media, { highWaterMark: 1 << 20 })) {
      progress.sent += (chunk as Buffer).length;
      yield chunk as Buffer;
    }
  }

  (async () => {
    const r = await fetch(`${link.url}/api/videos`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${link.token}`,
        "x-title": encodeURIComponent(meta.title),
        "x-transcript-length": String(head.length),
        "Content-Type": "application/octet-stream",
      },
      body: Readable.toWeb(Readable.from(body())) as ReadableStream,
      duplex: "half",
    } as RequestInit);
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) {
      await fs.rm(linkFile(), { force: true }); // revoked from the cloud side
      throw new Error("Recap Cloud signed this app out. Connect again.");
    }
    if (!r.ok) throw new Error(d.error ?? `Recap Cloud answered ${r.status}.`);
    db.prepare("UPDATE videos SET cloud_url = ?, cloud_version = ? WHERE id = ?").run(`${link.url}/v/${d.id}`, version, id);
    shares.delete(id);
  })().catch((err) => {
    progress.error = (err as Error).message;
  });
}
