import { toVtt } from "@/lib/captions";
import { readKeep } from "@/lib/pipeline";
import { readTranscript } from "@/lib/store";

export async function GET(req: Request, ctx: RouteContext<"/api/videos/[id]/captions">) {
  const { id } = await ctx.params;
  const t = await readTranscript(id);
  if (!t) return new Response("not found", { status: 404 });
  const clean = new URL(req.url).searchParams.get("v") === "clean";
  const keep = clean ? await readKeep(id) : undefined;
  if (clean && !keep) return new Response("not found", { status: 404 });
  return new Response(toVtt(t.words, keep ?? undefined), {
    headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
