import { currentUser } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { canView, countView, isOwner, readMeta } from "@/lib/store";

/** Called once when a viewer starts playback. Owners watching their own video don't count. */
export async function POST(_req: Request, ctx: RouteContext<"/api/videos/[id]/view">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  const meta = await readMeta(id);
  if (!meta || !canView(meta, user)) return Response.json({ error: "not found" }, { status: 404 });
  // At most one counted view per viewer per video every 30 minutes.
  if (!isOwner(meta, user) && !rateLimit(`view:${id}:${user?.id ?? await clientIp()}`, 1, 30 * 60_000)) countView(id);
  return new Response(null, { status: 204 });
}
