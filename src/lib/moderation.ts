import "server-only";
import { getUser } from "./auth";
import { db, now } from "./db";
import { notify } from "./email";
import { readMeta } from "./store";
import { baseUrl } from "./url";

// Abuse reports and takedowns. Anyone who can watch a shared video can report it; admins review the queue at
// /admin and either take the video down (it stops playing for everyone but its owner) or dismiss the report.

export const REPORT_REASONS = ["spam or scam", "harassment or hate", "sexual content", "violence", "copyright", "other"] as const;

/** Returns false when this reporter already has an open report on the video. */
export async function reportVideo(videoId: string, reporter: string, reason: string): Promise<boolean> {
  const added =
    db
      .prepare("INSERT OR IGNORE INTO reports (video_id, reason, reporter, created_at) VALUES (?, ?, ?, ?)")
      .run(videoId, reason, reporter, now()).changes > 0;
  if (!added) return false;
  // Tell the admins once per video while it has open reports, not once per report.
  const open = (db.prepare("SELECT count(*) AS n FROM reports WHERE video_id = ? AND resolved_at IS NULL").get(videoId) as { n: number }).n;
  if (open === 1) {
    const meta = await readMeta(videoId);
    const admins = db.prepare("SELECT email FROM users WHERE is_admin = 1 AND email_verified_at IS NOT NULL").all() as { email: string }[];
    for (const a of admins)
      notify({
        to: a.email,
        subject: `Report: “${meta?.title ?? videoId}”`,
        text: `Someone reported a video.\n\nReason: ${reason}`,
        action: { label: "Review reports", url: `${await baseUrl()}/admin` },
      });
  }
  return true;
}

export interface ReportGroup {
  videoId: string;
  title: string;
  owner: string;
  disabled: boolean;
  reports: { reason: string; createdAt: string }[];
}

export function openReports(): ReportGroup[] {
  const rows = db
    .prepare(
      `SELECT r.video_id, r.reason, r.created_at, v.title, v.disabled, u.email AS owner
       FROM reports r JOIN videos v ON v.id = r.video_id LEFT JOIN users u ON u.id = v.owner_id
       WHERE r.resolved_at IS NULL ORDER BY r.created_at`,
    )
    .all() as { video_id: string; reason: string; created_at: string; title: string; disabled: number; owner: string | null }[];
  const groups = new Map<string, ReportGroup>();
  for (const r of rows) {
    const g = groups.get(r.video_id) ?? { videoId: r.video_id, title: r.title, owner: r.owner ?? "", disabled: !!r.disabled, reports: [] };
    g.reports.push({ reason: r.reason, createdAt: r.created_at });
    groups.set(r.video_id, g);
  }
  return [...groups.values()];
}

export function takenDown(): { videoId: string; title: string; owner: string }[] {
  return db
    .prepare("SELECT v.id AS videoId, v.title, coalesce(u.email, '') AS owner FROM videos v LEFT JOIN users u ON u.id = v.owner_id WHERE v.disabled = 1 ORDER BY v.created_at DESC")
    .all() as { videoId: string; title: string; owner: string }[];
}

/** takedown: hide the video and close its reports. restore: undo a takedown. dismiss: close reports, change nothing. */
export async function moderate(videoId: string, action: "takedown" | "restore" | "dismiss"): Promise<boolean> {
  const meta = await readMeta(videoId);
  if (!meta) return false;
  if (action !== "restore") {
    db.prepare("UPDATE reports SET resolved_at = ?, resolution = ? WHERE video_id = ? AND resolved_at IS NULL").run(now(), action, videoId);
  }
  if (action === "dismiss") return true;
  const disabled = action === "takedown" ? 1 : 0;
  db.prepare("UPDATE videos SET disabled = ? WHERE id = ?").run(disabled, videoId);
  const owner = meta.ownerId ? getUser(meta.ownerId) : null;
  if (owner?.emailVerified && !!meta.disabled !== !!disabled) {
    notify({
      to: owner.email,
      subject: disabled ? `“${meta.title}” was taken down` : `“${meta.title}” is back up`,
      text: disabled
        ? "After a report, an admin took your video down. You can still open it, but nobody else can watch it.\n\nIf you think this was a mistake, contact the admin of this Recap server."
        : "An admin restored your video. Its link works again.",
      action: { label: "Open the video", url: `${await baseUrl()}/v/${videoId}` },
    });
  }
  return true;
}
