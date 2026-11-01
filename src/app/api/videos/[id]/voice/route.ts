import { createWriteStream, promises as fs } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { currentUser, unauthorized } from "@/lib/auth";
import { enqueue } from "@/lib/jobs";
import { readVoice, writeVoice } from "@/lib/make";
import { file, isOwner, readMeta } from "@/lib/store";

const MAX_BYTES = 512 * 1024 * 1024;

async function owned(ctx: RouteContext<"/api/videos/[id]/voice">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return { fail: unauthorized() };
  const meta = await readMeta(id);
  if (!meta || !isOwner(meta, user)) return { fail: Response.json({ error: "not found" }, { status: 404 }) };
  return { id, meta };
}

export async function GET(req: Request, ctx: RouteContext<"/api/videos/[id]/voice">) {
  const o = await owned(ctx);
  if (o.fail) return o.fail;
  if (new URL(req.url).searchParams.has("audio")) {
    const data = await fs.readFile(file(o.id, "voice.webm")).catch(() => null);
    return data ? new Response(data, { headers: { "Content-Type": "audio/webm", "Cache-Control": "no-store" } }) : new Response("not found", { status: 404 });
  }
  return Response.json({ voice: await readVoice(o.id) });
}

/** A voice-over take. Query: start (seconds into the video it begins at), edited (recorded over the saved edit). */
export async function POST(req: Request, ctx: RouteContext<"/api/videos/[id]/voice">) {
  const o = await owned(ctx);
  if (o.fail) return o.fail;
  if (!req.body) return Response.json({ error: "No audio." }, { status: 400 });
  const u = new URL(req.url);
  const edited = u.searchParams.get("edited") === "1" && o.meta.clean.status === "ready";
  const start = Math.max(0, Number(u.searchParams.get("start")) || 0);
  let bytes = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _e, cb) {
      bytes += chunk.length;
      cb(bytes > MAX_BYTES ? new Error("That voice-over is too long.") : null, chunk);
    },
  });
  const tmp = file(o.id, "voice.tmp.webm");
  try {
    await pipeline(Readable.fromWeb(req.body as NodeReadableStream), limit, createWriteStream(tmp));
    if (!bytes) throw new Error("No audio was recorded.");
    await fs.rename(tmp, file(o.id, "voice.webm"));
  } catch (err) {
    await fs.rm(tmp, { force: true });
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
  await writeVoice(o.id, { status: "transcribing", start, edited });
  enqueue("voice", o.id);
  return Response.json({ ok: true }, { status: 202 });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/videos/[id]/voice">) {
  const o = await owned(ctx);
  if (o.fail) return o.fail;
  for (const f of ["voice.webm", "voice.json"]) await fs.rm(file(o.id, f), { force: true });
  return Response.json({ ok: true });
}
