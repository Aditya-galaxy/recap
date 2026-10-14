import { promises as fs } from "node:fs";
import { file, ID_RE } from "@/lib/store";

export async function GET(_req: Request, ctx: RouteContext<"/api/videos/[id]/thumb">) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return new Response("not found", { status: 404 });
  try {
    const buf = await fs.readFile(file(id, "thumb.jpg"));
    return new Response(buf, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
