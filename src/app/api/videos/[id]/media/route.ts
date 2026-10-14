import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { currentUser } from "@/lib/auth";
import { canView, file, readMeta } from "@/lib/store";

/** Serves video.mp4 (or clean.mp4 with ?v=clean) with HTTP range support so the player can seek. */
export async function GET(req: Request, ctx: RouteContext<"/api/videos/[id]/media">) {
  const { id } = await ctx.params;
  const meta = await readMeta(id);
  if (!meta || !canView(meta, await currentUser())) return new Response("not found", { status: 404 });
  const url = new URL(req.url);
  const clean = url.searchParams.get("v") === "clean";
  const p = file(id, clean ? "clean.mp4" : "video.mp4");

  let size: number;
  try {
    size = (await fs.stat(p)).size;
  } catch {
    return new Response("not found", { status: 404 });
  }

  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache",
  };
  if (url.searchParams.has("download")) {
    // Name the export after the video ("Launch update (clean).mp4"), with an ASCII fallback for old clients.
    const name = `${meta.title.replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").trim().slice(0, 120) || id}${clean ? " (clean)" : ""}.mp4`;
    const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
    headers["Content-Disposition"] = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  }

  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (!range) {
    headers["Content-Length"] = String(size);
    return new Response(Readable.toWeb(createReadStream(p)) as ReadableStream, { headers });
  }

  let start = range[1] ? Number(range[1]) : NaN;
  let end = range[2] ? Number(range[2]) : size - 1;
  if (Number.isNaN(start)) {
    // Suffix range: "bytes=-500" is the last 500 bytes.
    start = Math.max(0, size - end);
    end = size - 1;
  }
  end = Math.min(end, size - 1);
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  headers["Content-Length"] = String(end - start + 1);
  return new Response(Readable.toWeb(createReadStream(p, { start, end })) as ReadableStream, { status: 206, headers });
}
