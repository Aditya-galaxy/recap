import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { currentUser, unauthorized } from "@/lib/auth";
import { config } from "@/lib/config";
import { enqueue } from "@/lib/jobs";
import { rateLimit } from "@/lib/ratelimit";
import { createVideo, deleteVideo, file, listVideos, setSize } from "@/lib/store";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const u = new URL(req.url);
  const limit = Math.min(500, Math.max(1, Number(u.searchParams.get("limit")) || 100));
  const offset = Math.max(0, Number(u.searchParams.get("offset")) || 0);
  const { videos, total } = await listVideos(user.id, { q: u.searchParams.get("q") ?? "", limit, offset });
  return Response.json(videos, { headers: { "X-Total-Count": String(total) } });
}

class TooLarge extends Error {}

/** Upload a raw recording as the request body. Title comes from the x-title header. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const limited = rateLimit(`upload:${user.id}`, 60, 60 * 60_000);
  if (limited) return limited;
  if (!req.body) return Response.json({ error: "Empty upload." }, { status: 400 });

  const max = config.maxUploadBytes;
  const tooLarge = () => Response.json({ error: `Upload is larger than the ${Math.round(max / 1048576)} MB limit.` }, { status: 413 });
  if (Number(req.headers.get("content-length") ?? 0) > max) return tooLarge();

  let title = "";
  try {
    title = decodeURIComponent(req.headers.get("x-title") ?? "").trim().slice(0, 200);
  } catch {
    /* malformed header: fall back to a default title */
  }
  const meta = await createVideo(title || defaultTitle(), user.id);

  // Count bytes as they stream in; chunked uploads have no Content-Length to check up front.
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      bytes += chunk.length;
      cb(bytes > max ? new TooLarge() : null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(req.body as NodeReadableStream), limiter, createWriteStream(file(meta.id, "original")));
  } catch (err) {
    await deleteVideo(meta.id);
    if (err instanceof TooLarge) return tooLarge();
    return Response.json({ error: `Upload failed: ${(err as Error).message}` }, { status: 500 });
  }
  if (bytes === 0) {
    await deleteVideo(meta.id);
    return Response.json({ error: "Empty upload." }, { status: 400 });
  }
  setSize(meta.id, bytes);
  enqueue("process", meta.id);
  return Response.json(meta, { status: 201 });
}

function defaultTitle() {
  const d = new Date();
  return `Recording ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}
