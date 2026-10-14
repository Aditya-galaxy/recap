import { promises as fs } from "node:fs";
import { currentUser } from "@/lib/auth";
import { canView, file, readMeta } from "@/lib/store";

export async function GET(_req: Request, ctx: RouteContext<"/api/videos/[id]/thumb">) {
  const { id } = await ctx.params;
  const meta = await readMeta(id);
  if (!meta || !canView(meta, await currentUser())) return new Response("not found", { status: 404 });
  try {
    const buf = await fs.readFile(file(id, "thumb.jpg"));
    // Link-preview crawlers (Slack, X, iMessage) fetch this for unlisted videos.
    const cache = meta.visibility === "unlisted" ? "public, max-age=300" : "private, max-age=300";
    return new Response(buf, { headers: { "Content-Type": "image/jpeg", "Cache-Control": cache } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
