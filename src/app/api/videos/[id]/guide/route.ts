import { promises as fs } from "node:fs";
import { currentUser, unauthorized } from "@/lib/auth";
import { guideHtml, guideMarkdown, IMAGE_RE, imagePath, readGuide, writeGuide, type Guide } from "@/lib/guide";
import { enqueue } from "@/lib/jobs";
import { canView, isOwner, readMeta } from "@/lib/store";

const fileName = (title: string, ext: string) => {
  const name = `${title.replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").trim().slice(0, 120) || "Guide"} – guide.${ext}`;
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};

/** The guide (JSON), one of its screenshots (?image=), or an export (?format=html|md). */
export async function GET(req: Request, ctx: RouteContext<"/api/videos/[id]/guide">) {
  const { id } = await ctx.params;
  const meta = await readMeta(id);
  if (!meta || !canView(meta, await currentUser())) return Response.json({ error: "not found" }, { status: 404 });
  const url = new URL(req.url);
  const image = url.searchParams.get("image");
  if (image) {
    if (!IMAGE_RE.test(image)) return new Response("not found", { status: 404 });
    const data = await fs.readFile(imagePath(id, image)).catch(() => null);
    if (!data) return new Response("not found", { status: 404 });
    // Names change on every remake, so a long cache is safe.
    return new Response(new Uint8Array(data), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" } });
  }
  const g = await readGuide(id);
  const format = url.searchParams.get("format");
  if (format === "html" || format === "md") {
    if (g?.status !== "ready") return Response.json({ error: "No guide yet." }, { status: 404 });
    return format === "html"
      ? new Response(await guideHtml(id, g), { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": fileName(g.title, "html") } })
      : new Response(guideMarkdown(g), { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": fileName(g.title, "md") } });
  }
  return Response.json({ guide: g });
}

/** Make (or remake) the guide from the recording. */
export async function POST(_req: Request, ctx: RouteContext<"/api/videos/[id]/guide">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return unauthorized();
  const meta = await readMeta(id);
  if (!meta || !isOwner(meta, user)) return Response.json({ error: "not found" }, { status: 404 });
  if (meta.status !== "ready") return Response.json({ error: "Video is still processing." }, { status: 409 });
  const g = await readGuide(id);
  if (g?.status === "making") return Response.json({ error: "Already making the guide." }, { status: 409 });
  const next: Guide = { status: "making", title: g?.title ?? meta.title, steps: g?.steps ?? [], updatedAt: new Date().toISOString() };
  await writeGuide(id, next);
  enqueue("guide", id);
  return Response.json({ guide: next }, { status: 202 });
}

/** Save edits: title, step text, order, deletions. Steps can only reference screenshots the guide already has. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/videos/[id]/guide">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return unauthorized();
  const meta = await readMeta(id);
  if (!meta || !isOwner(meta, user)) return Response.json({ error: "not found" }, { status: 404 });
  const g = await readGuide(id);
  if (g?.status !== "ready") return Response.json({ error: "No guide to edit." }, { status: 409 });
  const b = await req.json().catch(() => null);
  if (!b || !Array.isArray(b.steps)) return Response.json({ error: "Bad request." }, { status: 400 });
  const known = new Map(g.steps.map((s) => [s.image, s]));
  const steps = (b.steps as unknown[])
    .map((x) => x as { image?: unknown; text?: unknown })
    .filter((x) => typeof x.image === "string" && known.has(x.image))
    .map((x) => ({ ...known.get(x.image as string)!, text: typeof x.text === "string" ? x.text.slice(0, 2000) : "" }));
  const title = typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 200) : g.title;
  const next: Guide = { ...g, title, steps, updatedAt: new Date().toISOString() };
  await writeGuide(id, next);
  return Response.json({ guide: next });
}
