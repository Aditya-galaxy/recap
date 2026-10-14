import { deleteVideo, readMeta, readTranscript, updateMeta } from "@/lib/store";

export async function GET(_req: Request, ctx: RouteContext<"/api/videos/[id]">) {
  const { id } = await ctx.params;
  const meta = await readMeta(id);
  if (!meta) return Response.json({ error: "not found" }, { status: 404 });
  const transcript = meta.status === "ready" ? await readTranscript(id) : null;
  return Response.json({ meta, transcript });
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/videos/[id]">) {
  const { id } = await ctx.params;
  if (!(await readMeta(id))) return Response.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  if (!title) return Response.json({ error: "title required" }, { status: 400 });
  return Response.json(await updateMeta(id, (m) => { m.title = title; }));
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/videos/[id]">) {
  const { id } = await ctx.params;
  if (!(await readMeta(id))) return Response.json({ error: "not found" }, { status: 404 });
  await deleteVideo(id);
  return new Response(null, { status: 204 });
}
