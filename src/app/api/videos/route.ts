import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { connection } from "next/server";
import { processVideo } from "@/lib/pipeline";
import { createVideo, deleteVideo, file, listVideos } from "@/lib/store";

export async function GET() {
  await connection();
  return Response.json(await listVideos());
}

/** Upload a raw recording as the request body. Title comes from the x-title header. */
export async function POST(req: Request) {
  if (!req.body) return Response.json({ error: "empty body" }, { status: 400 });
  const raw = req.headers.get("x-title");
  const title = (raw ? decodeURIComponent(raw) : "").trim().slice(0, 200) || defaultTitle();
  const meta = await createVideo(title);
  try {
    await pipeline(Readable.fromWeb(req.body as NodeReadableStream), createWriteStream(file(meta.id, "original")));
  } catch (err) {
    await deleteVideo(meta.id);
    return Response.json({ error: `upload failed: ${(err as Error).message}` }, { status: 500 });
  }
  void processVideo(meta.id);
  return Response.json(meta, { status: 201 });
}

function defaultTitle() {
  const d = new Date();
  return `Recording ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}
