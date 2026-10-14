import { currentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { addReaction, REACTIONS, reactionSummary, viewerKey } from "@/lib/social";
import { canView, readMeta } from "@/lib/store";

export async function GET(_req: Request, ctx: RouteContext<"/api/videos/[id]/reactions">) {
  const { id } = await ctx.params;
  const meta = await readMeta(id);
  if (!meta || !canView(meta, await currentUser())) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(reactionSummary(id));
}

/** Anyone who can watch can react (no account needed), rate-limited per viewer. */
export async function POST(req: Request, ctx: RouteContext<"/api/videos/[id]/reactions">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  const meta = await readMeta(id);
  if (!meta || !canView(meta, user)) return Response.json({ error: "not found" }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  if (!REACTIONS.includes(b.emoji)) return Response.json({ error: "Unknown reaction." }, { status: 400 });
  const viewer = await viewerKey(user);
  const limited = rateLimit(`react:${id}:${viewer}`, 30, 10 * 60_000);
  if (limited) return limited;
  const t = Number.isFinite(Number(b.t)) && b.t !== null ? Math.max(0, Number(b.t)) : null;
  addReaction(id, viewer, b.emoji, t);
  return Response.json(reactionSummary(id), { status: 201 });
}
