import "server-only";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Transcript, VideoMeta } from "./types";

export const DATA_DIR = path.join(process.cwd(), "data", "videos");

export const ID_RE = /^[a-z0-9]{10}$/;

export function newId() {
  const alphabet = "abcdefghijkmnopqrstuvwxyz23456789";
  return Array.from(randomBytes(10), (b) => alphabet[b % alphabet.length]).join("");
}

export function videoDir(id: string) {
  if (!ID_RE.test(id)) throw new Error("bad id");
  return path.join(DATA_DIR, id);
}

export const file = (id: string, name: string) => path.join(videoDir(id), name);

export async function readMeta(id: string): Promise<VideoMeta | null> {
  if (!ID_RE.test(id)) return null;
  try {
    return JSON.parse(await fs.readFile(file(id, "meta.json"), "utf8"));
  } catch {
    return null;
  }
}

// Writes are serialized per video so concurrent pipeline steps can't clobber each other.
const locks = new Map<string, Promise<unknown>>();

export function updateMeta(id: string, patch: (m: VideoMeta) => void | VideoMeta): Promise<VideoMeta> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.then(async () => {
    const meta = await readMeta(id);
    if (!meta) throw new Error(`video ${id} not found`);
    const out = patch(meta) ?? meta;
    const tmp = file(id, `meta.${process.pid}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(out, null, 2));
    await fs.rename(tmp, file(id, "meta.json"));
    return out;
  });
  locks.set(id, next.catch(() => {}));
  return next;
}

export async function createVideo(title: string): Promise<VideoMeta> {
  const id = newId();
  await fs.mkdir(videoDir(id), { recursive: true });
  const meta: VideoMeta = {
    id,
    title,
    createdAt: new Date().toISOString(),
    status: "uploaded",
    clean: { status: "none" },
  };
  await fs.writeFile(file(id, "meta.json"), JSON.stringify(meta, null, 2));
  return meta;
}

export async function listVideos(): Promise<VideoMeta[]> {
  let ids: string[] = [];
  try {
    ids = await fs.readdir(DATA_DIR);
  } catch {
    return [];
  }
  const metas = await Promise.all(ids.filter((i) => ID_RE.test(i)).map(readMeta));
  return metas
    .filter((m): m is VideoMeta => !!m)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readTranscript(id: string): Promise<Transcript | null> {
  try {
    return JSON.parse(await fs.readFile(file(id, "transcript.json"), "utf8"));
  } catch {
    return null;
  }
}

export async function deleteVideo(id: string) {
  await fs.rm(videoDir(id), { recursive: true, force: true });
}

export async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
