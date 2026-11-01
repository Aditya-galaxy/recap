import { currentUser, unauthorized } from "@/lib/auth";
import { enqueue } from "@/lib/jobs";
import { readMade, writeMade, type MakeFormat, type MakeOptions } from "@/lib/make";
import { isOwner, readMeta } from "@/lib/store";

export async function GET(_req: Request, ctx: RouteContext<"/api/videos/[id]/make">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return unauthorized();
  const meta = await readMeta(id);
  if (!meta || !isOwner(meta, user)) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ made: await readMade(id) });
}

export async function POST(req: Request, ctx: RouteContext<"/api/videos/[id]/make">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return unauthorized();
  const meta = await readMeta(id);
  if (!meta || !isOwner(meta, user)) return Response.json({ error: "not found" }, { status: 404 });
  if (meta.status !== "ready") return Response.json({ error: "Video is still processing." }, { status: 409 });
  if ((await readMade(id))?.status === "rendering") return Response.json({ error: "Already making one." }, { status: 409 });

  const b = await req.json().catch(() => ({}));
  const line = (v: unknown) => (typeof v === "string" ? v.slice(0, 120) : "");
  const options: MakeOptions = {
    format: (["wide", "square", "vertical"] as MakeFormat[]).includes(b.format) ? b.format : "wide",
    captions: b.captions !== false,
    endCard: b.endCard !== false,
    endTitle: line(b.endTitle),
    endLink: line(b.endLink),
    small: b.small === true,
    edited: b.edited === true && meta.clean.status === "ready",
  };
  await writeMade(id, { status: "rendering", options });
  enqueue("make", id, options);
  return Response.json({ ok: true }, { status: 202 });
}
