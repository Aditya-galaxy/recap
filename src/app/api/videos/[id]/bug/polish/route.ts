import { aiStatus } from "@/lib/ai";
import { currentUser, unauthorized } from "@/lib/auth";
import { enqueue } from "@/lib/jobs";
import { readReport, writeReport } from "@/lib/report";
import { isOwner, readMeta } from "@/lib/store";

/** Polish the report with the on-device model. */
export async function POST(_req: Request, ctx: RouteContext<"/api/videos/[id]/bug/polish">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return unauthorized();
  const meta = await readMeta(id);
  if (!meta || !isOwner(meta, user)) return Response.json({ error: "not found" }, { status: 404 });
  const ai = await aiStatus();
  if (!ai.available || ai.model !== "ready") return Response.json({ error: "Download the AI model first." }, { status: 409 });
  const r = await readReport(id);
  if (r?.status !== "ready") return Response.json({ error: "Make the report first." }, { status: 409 });
  const next = { ...r, status: "polishing" as const, progress: 0, error: undefined };
  await writeReport(id, next);
  enqueue("report-polish", id);
  return Response.json({ report: next }, { status: 202 });
}
