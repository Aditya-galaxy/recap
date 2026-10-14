import { currentUser, unauthorized } from "@/lib/auth";
import { commentAuthor, deleteComment } from "@/lib/social";
import { isOwner, readMeta } from "@/lib/store";

/** The comment's author or the video's owner can delete it. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/videos/[id]/comments/[cid]">) {
  const { id, cid } = await ctx.params;
  const user = await currentUser();
  if (!user) return unauthorized();
  const meta = await readMeta(id);
  if (!meta) return Response.json({ error: "not found" }, { status: 404 });
  if (commentAuthor(cid) !== user.id && !isOwner(meta, user)) return Response.json({ error: "not allowed" }, { status: 403 });
  return deleteComment(cid, id) ? new Response(null, { status: 204 }) : Response.json({ error: "not found" }, { status: 404 });
}
