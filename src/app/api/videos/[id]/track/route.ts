import { promises as fs } from "node:fs";
import { currentUser, unauthorized } from "@/lib/auth";
import { file, isOwner, readMeta } from "@/lib/store";

/** Clicks and where the cursor settled during a recording, sent by the desktop app. Used by auto-zoom. */
export async function POST(req: Request, ctx: RouteContext<"/api/videos/[id]/track">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return unauthorized();
  const meta = await readMeta(id);
  if (!meta || !isOwner(meta, user)) return Response.json({ error: "not found" }, { status: 404 });
  const b = await req.json().catch(() => null);
  const points = (v: unknown) =>
    (Array.isArray(v) ? v : []).slice(0, 20000).flatMap((p: { t?: unknown; x?: unknown; y?: unknown }) => {
      const [t, x, y] = [Number(p?.t), Number(p?.x), Number(p?.y)];
      return t >= 0 && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? [{ t, x, y }] : [];
    });
  await fs.writeFile(file(id, "track.json"), JSON.stringify({ clicks: points(b?.clicks), stops: points(b?.stops) }));
  return Response.json({ ok: true });
}
