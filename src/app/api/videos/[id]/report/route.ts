import { currentUser } from "@/lib/auth";
import { REPORT_REASONS, reportVideo } from "@/lib/moderation";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { viewerKey } from "@/lib/social";
import { canView, isOwner, readMeta } from "@/lib/store";

/** Anyone who can watch a video can report it (no account needed). One open report per viewer per video. */
export async function POST(req: Request, ctx: RouteContext<"/api/videos/[id]/report">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  const meta = await readMeta(id);
  if (!meta || !canView(meta, user) || isOwner(meta, user)) return Response.json({ error: "not found" }, { status: 404 });
  const limited = rateLimit(`report:${await clientIp()}`, 10, 60 * 60_000);
  if (limited) return limited;
  const b = await req.json().catch(() => ({}));
  const reason = String(b.reason ?? "");
  if (!(REPORT_REASONS as readonly string[]).includes(reason)) return Response.json({ error: "Pick a reason." }, { status: 400 });
  const details = String(b.details ?? "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").trim().slice(0, 500);
  const added = await reportVideo(id, await viewerKey(user), details ? `${reason}: ${details}` : reason);
  return Response.json({ ok: true, alreadyReported: !added }, { status: added ? 201 : 200 });
}
