import { currentUser, unauthorized } from "@/lib/auth";
import { canView, deleteVideo, isOwner, readMeta, readTranscript, updateMeta } from "@/lib/store";

const notFound = () => Response.json({ error: "not found" }, { status: 404 });

export async function GET(_req: Request, ctx: RouteContext<"/api/videos/[id]">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  const meta = await readMeta(id);
  if (!meta || !canView(meta, user)) return notFound();
  const transcript = meta.status === "ready" ? await readTranscript(id) : null;
  return Response.json({ meta, transcript, isOwner: isOwner(meta, user) });
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/videos/[id]">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return unauthorized();
  const meta = await readMeta(id);
  if (!meta || !isOwner(meta, user)) return notFound();

  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : undefined;
  const visibility = body.visibility === "private" || body.visibility === "unlisted" ? body.visibility : undefined;
  if (title === "") return Response.json({ error: "Title can't be empty." }, { status: 400 });
  if (title === undefined && visibility === undefined) return Response.json({ error: "Nothing to update." }, { status: 400 });
  return Response.json(
    await updateMeta(id, (m) => {
      if (title) m.title = title;
      if (visibility) m.visibility = visibility;
    }),
  );
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/videos/[id]">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return unauthorized();
  const meta = await readMeta(id);
  if (!meta || !isOwner(meta, user)) return notFound();
  await deleteVideo(id);
  return new Response(null, { status: 204 });
}
