import { aiStatus } from "@/lib/ai";
import { currentUser, unauthorized } from "@/lib/auth";
import { readGuide, writeGuide } from "@/lib/guide";
import { enqueue } from "@/lib/jobs";
import { isOwner, readMeta } from "@/lib/store";

/** Polish the guide's steps with the on-device model. */
export async function POST(_req: Request, ctx: RouteContext<"/api/videos/[id]/guide/polish">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return unauthorized();
  const meta = await readMeta(id);
  if (!meta || !isOwner(meta, user)) return Response.json({ error: "not found" }, { status: 404 });
  const ai = await aiStatus();
  if (!ai.available || ai.model !== "ready") return Response.json({ error: "Download the AI model first." }, { status: 409 });
  const g = await readGuide(id);
  if (g?.status !== "ready" || !g.steps.length) return Response.json({ error: "Make the guide first." }, { status: 409 });
  const next = { ...g, status: "polishing" as const, progress: 0, error: undefined };
  await writeGuide(id, next);
  enqueue("polish", id);
  return Response.json({ guide: next }, { status: 202 });
}
