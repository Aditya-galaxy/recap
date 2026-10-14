import { currentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { notifyFirstView, recordView, viewerKey } from "@/lib/social";
import { canView, countView, isOwner, readMeta } from "@/lib/store";

/**
 * Sent by the player when playback starts and periodically while watching, with how far the viewer
 * got (0..1). The owner's own viewing never counts.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/videos/[id]/view">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  const meta = await readMeta(id);
  if (!meta || !canView(meta, user)) return Response.json({ error: "not found" }, { status: 404 });
  if (isOwner(meta, user)) return new Response(null, { status: 204 });
  const viewer = await viewerKey(user);
  if (rateLimit(`viewping:${id}:${viewer}`, 120, 60 * 60_000)) return new Response(null, { status: 204 });
  const b = await req.json().catch(() => ({}));
  const isNew = recordView(id, viewer, user?.id ?? null, Number(b.progress) || 0);
  if (isNew) {
    countView(id);
    await notifyFirstView(id, user);
  }
  return new Response(null, { status: 204 });
}
