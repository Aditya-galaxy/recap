import "server-only";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { User } from "./auth";
import { config } from "./config";
import { db, now } from "./db";
import type { Transcript, VideoMeta, Visibility } from "./types";

export const DATA_DIR = path.join(config.dataDir, "videos");

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

type Row = {
  id: string; owner_id: string | null; title: string; visibility: Visibility; status: VideoMeta["status"];
  stage: string | null; error: string | null; duration: number | null; width: number | null; height: number | null;
  clean_status: VideoMeta["clean"]["status"]; clean_options: string | null; clean_duration: number | null;
  clean_error: string | null; views: number; disabled: number; created_at: string;
};

const opt = <T,>(v: T | null) => (v === null ? undefined : v);

function toMeta(r: Row): VideoMeta {
  return {
    id: r.id,
    ownerId: r.owner_id,
    title: r.title,
    visibility: r.visibility,
    views: r.views,
    createdAt: r.created_at,
    disabled: !!r.disabled || undefined,
    status: r.status,
    stage: opt(r.stage),
    error: opt(r.error),
    duration: opt(r.duration),
    width: opt(r.width),
    height: opt(r.height),
    clean: {
      status: r.clean_status,
      options: r.clean_options ? JSON.parse(r.clean_options) : undefined,
      duration: opt(r.clean_duration),
      error: opt(r.clean_error),
    },
  };
}

export async function readMeta(id: string): Promise<VideoMeta | null> {
  if (!ID_RE.test(id)) return null;
  const r = db.prepare("SELECT * FROM videos WHERE id = ?").get(id) as Row | undefined;
  return r ? toMeta(r) : null;
}

/** Read-modify-write. SQLite calls are synchronous, so nothing can interleave between the read and the write. */
export async function updateMeta(id: string, patch: (m: VideoMeta) => void | VideoMeta): Promise<VideoMeta> {
  const r = db.prepare("SELECT * FROM videos WHERE id = ?").get(id) as Row | undefined;
  if (!r) throw new Error(`video ${id} not found`);
  const m = toMeta(r);
  const out = patch(m) ?? m;
  db.prepare(
    `UPDATE videos SET title = ?, visibility = ?, status = ?, stage = ?, error = ?, duration = ?, width = ?, height = ?,
       clean_status = ?, clean_options = ?, clean_duration = ?, clean_error = ? WHERE id = ?`,
  ).run(
    out.title, out.visibility, out.status, out.stage ?? null, out.error ?? null, out.duration ?? null, out.width ?? null,
    out.height ?? null, out.clean.status, out.clean.options ? JSON.stringify(out.clean.options) : null,
    out.clean.duration ?? null, out.clean.error ?? null, id,
  );
  return out;
}

export async function createVideo(title: string, ownerId: string): Promise<VideoMeta> {
  const id = newId();
  await fs.mkdir(videoDir(id), { recursive: true });
  db.prepare("INSERT INTO videos (id, owner_id, title, status, created_at) VALUES (?, ?, ?, 'uploaded', ?)").run(id, ownerId, title, now());
  return (await readMeta(id))!;
}

/** One page of a user's library, newest first, optionally filtered by a title search. */
export async function listVideos(
  ownerId: string,
  { q = "", limit = 48, offset = 0 }: { q?: string; limit?: number; offset?: number } = {},
): Promise<{ videos: VideoMeta[]; total: number }> {
  const like = `%${q.trim().replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const where = q.trim() ? "WHERE owner_id = ? AND title LIKE ? ESCAPE '\\'" : "WHERE owner_id = ?";
  const args = q.trim() ? [ownerId, like] : [ownerId];
  const total = (db.prepare(`SELECT count(*) AS n FROM videos ${where}`).get(...args) as { n: number }).n;
  const rows = db.prepare(`SELECT * FROM videos ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as Row[];
  return { videos: rows.map(toMeta), total };
}

export async function readTranscript(id: string): Promise<Transcript | null> {
  try {
    const t: Transcript = JSON.parse(await fs.readFile(file(id, "transcript.json"), "utf8"));
    // Transcripts made by v0.2.0 could carry Whisper control tokens like <|endoftext|>.
    for (const w of t.words) w.text = w.text.replace(/<\|[^|]*\|>/g, "");
    t.words = t.words.filter((w) => w.text.trim());
    return t;
  } catch {
    return null;
  }
}

export async function deleteVideo(id: string) {
  db.prepare("DELETE FROM videos WHERE id = ?").run(id);
  await fs.rm(videoDir(id), { recursive: true, force: true });
}

export function countView(id: string) {
  db.prepare("UPDATE videos SET views = views + 1 WHERE id = ?").run(id);
}

export function setSize(id: string, bytes: number) {
  db.prepare("UPDATE videos SET size_bytes = ? WHERE id = ?").run(bytes, id);
}

export const isOwner = (m: VideoMeta, u: User | null) => !!u && m.ownerId === u.id;

/**
 * Unlisted videos are watchable by anyone with the link; private ones only by their owner. A video taken down
 * after a report stays visible to its owner, and to admins so they can review it; nobody else.
 */
export const canView = (m: VideoMeta, u: User | null) =>
  isOwner(m, u) || (m.visibility === "unlisted" && (!m.disabled || !!u?.isAdmin));

export async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
