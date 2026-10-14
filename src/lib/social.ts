import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getUser, randomId, type User } from "./auth";
import { db, now } from "./db";
import { notify } from "./email";
import { readMeta } from "./store";
import type { VideoMeta } from "./types";
import { baseUrl } from "./url";

// Comments, reactions and viewer insights for shared videos.

export const REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "🤔"] as const;
const VIEWER_COOKIE = "recap_v";

/** A stable, anonymous id per browser, so reactions and views can be de-duplicated without an account. */
export async function viewerKey(user: User | null): Promise<string> {
  if (user) return `u:${user.id}`;
  const jar = await cookies();
  let v = jar.get(VIEWER_COOKIE)?.value;
  if (!v || !/^[A-Za-z0-9_-]{22}$/.test(v)) {
    v = randomBytes(16).toString("base64url");
    jar.set(VIEWER_COOKIE, v, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 86_400 });
  }
  return `a:${v}`;
}

const displayName = (u: { name: string; email: string }) => u.name.trim() || u.email.split("@")[0];

// ---- comments ---------------------------------------------------------------------------

export interface Comment {
  id: string;
  author: string;
  authorId: string;
  t: number | null;
  body: string;
  createdAt: string;
}

export function listComments(videoId: string): Comment[] {
  return (
    db
      .prepare(
        "SELECT c.id, c.user_id, c.t, c.body, c.created_at, u.name, u.email FROM comments c JOIN users u ON u.id = c.user_id WHERE c.video_id = ? ORDER BY c.created_at",
      )
      .all(videoId) as { id: string; user_id: string; t: number | null; body: string; created_at: string; name: string; email: string }[]
  ).map((r) => ({ id: r.id, author: displayName(r), authorId: r.user_id, t: r.t, body: r.body, createdAt: r.created_at }));
}

export async function addComment(video: VideoMeta, author: User, body: string, t: number | null): Promise<Comment> {
  const id = randomId(10);
  db.prepare("INSERT INTO comments (id, video_id, user_id, t, body, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, video.id, author.id, t, body, now());
  const owner = video.ownerId ? getUser(video.ownerId) : null;
  if (owner && owner.id !== author.id && owner.notifyComments && owner.emailVerified) {
    const at = t !== null ? ` at ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}` : "";
    notify({
      to: owner.email,
      subject: `${displayName(author)} commented on “${video.title}”`,
      text: `${displayName(author)} commented${at}:\n\n${body}`,
      action: { label: "Open the video", url: `${await baseUrl()}/v/${video.id}` },
    });
  }
  return { id, author: displayName(author), authorId: author.id, t, body, createdAt: now() };
}

export function deleteComment(commentId: string, videoId: string) {
  return db.prepare("DELETE FROM comments WHERE id = ? AND video_id = ?").run(commentId, videoId).changes > 0;
}

export function commentAuthor(commentId: string) {
  return (db.prepare("SELECT user_id FROM comments WHERE id = ?").get(commentId) as { user_id: string } | undefined)?.user_id ?? null;
}

// ---- reactions --------------------------------------------------------------------------

export function addReaction(videoId: string, viewer: string, emoji: string, t: number | null) {
  db.prepare("INSERT INTO reactions (video_id, viewer, emoji, t, created_at) VALUES (?, ?, ?, ?, ?)").run(videoId, viewer, emoji, t, now());
}

export function reactionSummary(videoId: string) {
  const counts = db.prepare("SELECT emoji, count(*) AS n FROM reactions WHERE video_id = ? GROUP BY emoji").all(videoId) as { emoji: string; n: number }[];
  const marks = db.prepare("SELECT emoji, t FROM reactions WHERE video_id = ? AND t IS NOT NULL ORDER BY t LIMIT 500").all(videoId) as { emoji: string; t: number }[];
  return { counts: Object.fromEntries(counts.map((c) => [c.emoji, c.n])), marks };
}

// ---- views + insights --------------------------------------------------------------------

/** Records (or updates) one viewer's session; returns true if this is a new viewer. */
export function recordView(videoId: string, viewer: string, userId: string | null, progress: number) {
  const p = Math.max(0, Math.min(1, progress || 0));
  const existing = db.prepare("SELECT progress FROM view_sessions WHERE video_id = ? AND viewer = ?").get(videoId, viewer) as { progress: number } | undefined;
  if (existing) {
    db.prepare("UPDATE view_sessions SET progress = max(progress, ?), last_at = ? WHERE video_id = ? AND viewer = ?").run(p, now(), videoId, viewer);
    return false;
  }
  db.prepare("INSERT INTO view_sessions (video_id, viewer, user_id, progress, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?)").run(videoId, viewer, userId, p, now(), now());
  return true;
}

/** Emails the owner the first time someone else watches a video (once per video). */
export async function notifyFirstView(videoId: string, viewer: User | null) {
  const claimed = db.prepare("UPDATE videos SET first_view_notified = 1 WHERE id = ? AND first_view_notified = 0").run(videoId).changes > 0;
  if (!claimed) return;
  const video = await readMeta(videoId);
  const owner = video?.ownerId ? getUser(video.ownerId) : null;
  if (!video || !owner || !owner.notifyViews || !owner.emailVerified) return;
  notify({
    to: owner.email,
    subject: `${viewer ? displayName(viewer) : "Someone"} is watching “${video.title}”`,
    text: `Your video just got its first view${viewer ? ` from ${displayName(viewer)}` : ""}. See who watched and how far in the video's insights.`,
    action: { label: "See insights", url: `${await baseUrl()}/v/${video.id}` },
  });
}

export function insights(videoId: string) {
  const rows = db
    .prepare(
      "SELECT s.viewer, s.progress, s.last_at, u.name, u.email FROM view_sessions s LEFT JOIN users u ON u.id = s.user_id WHERE s.video_id = ? ORDER BY s.last_at DESC",
    )
    .all(videoId) as { viewer: string; progress: number; last_at: string; name: string | null; email: string | null }[];
  const n = rows.length;
  const reached = (f: number) => rows.filter((r) => r.progress >= f).length;
  return {
    uniqueViewers: n,
    avgCompletion: n ? rows.reduce((a, r) => a + r.progress, 0) / n : 0,
    funnel: { started: n, quarter: reached(0.25), half: reached(0.5), threeQuarters: reached(0.75), finished: reached(0.95) },
    viewers: rows.slice(0, 50).map((r) => ({
      who: r.email ? displayName({ name: r.name ?? "", email: r.email }) : "anonymous viewer",
      progress: r.progress,
      lastAt: r.last_at,
    })),
  };
}
