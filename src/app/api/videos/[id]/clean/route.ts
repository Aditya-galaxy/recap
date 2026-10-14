import { currentUser, unauthorized } from "@/lib/auth";
import { enqueue } from "@/lib/jobs";
import { PermanentError, prepareClean } from "@/lib/pipeline";
import { isOwner, readMeta } from "@/lib/store";
import { DEFAULT_CLEAN, type CleanOptions } from "@/lib/types";

export async function POST(req: Request, ctx: RouteContext<"/api/videos/[id]/clean">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return unauthorized();
  const meta = await readMeta(id);
  if (!meta || !isOwner(meta, user)) return Response.json({ error: "not found" }, { status: 404 });
  if (meta.status !== "ready") return Response.json({ error: "Video is still processing." }, { status: 409 });
  if (meta.clean.status === "rendering") return Response.json({ error: "Already rendering." }, { status: 409 });

  const b = await req.json().catch(() => ({}));
  const opts: CleanOptions = {
    silences: typeof b.silences === "boolean" ? b.silences : DEFAULT_CLEAN.silences,
    minSilence: Math.min(5, Math.max(0.4, Number(b.minSilence) || DEFAULT_CLEAN.minSilence)),
    fillers: typeof b.fillers === "boolean" ? b.fillers : DEFAULT_CLEAN.fillers,
    aggressive: b.aggressive === true,
  };
  try {
    await prepareClean(id, opts);
  } catch (err) {
    const status = err instanceof PermanentError ? 400 : 500;
    return Response.json({ error: (err as Error).message }, { status });
  }
  enqueue("clean", id, opts);
  return Response.json({ ok: true }, { status: 202 });
}
