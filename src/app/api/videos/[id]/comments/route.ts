import { currentUser, unauthorized } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { addComment, listComments } from "@/lib/social";
import { canView, readMeta } from "@/lib/store";

export async function GET(_req: Request, ctx: RouteContext<"/api/videos/[id]/comments">) {
  const { id } = await ctx.params;
  const meta = await readMeta(id);
  if (!meta || !canView(meta, await currentUser())) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(listComments(id));
}

/** Comments need a confirmed account: it names the author and keeps drive-by spam out. */
export async function POST(req: Request, ctx: RouteContext<"/api/videos/[id]/comments">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return unauthorized();
  if (!user.emailVerified) return Response.json({ error: "Confirm your email to comment." }, { status: 403 });
  const meta = await readMeta(id);
  if (!meta || !canView(meta, user)) return Response.json({ error: "not found" }, { status: 404 });
  const limited = rateLimit(`comment:${user.id}`, 20, 10 * 60_000);
  if (limited) return limited;
  const b = await req.json().catch(() => ({}));
  const body = String(b.body ?? "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").trim();
  if (!body) return Response.json({ error: "Write something first." }, { status: 400 });
  if (body.length > 2000) return Response.json({ error: "Keep it under 2,000 characters." }, { status: 400 });
  const t = Number.isFinite(Number(b.t)) && b.t !== null ? Math.max(0, Math.min(Number(b.t), meta.duration ?? Number(b.t))) : null;
  return Response.json(await addComment(meta, user, body, t), { status: 201 });
}
