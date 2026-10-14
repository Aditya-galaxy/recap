import { connection } from "next/server";
import { db } from "@/lib/db";
import { queueDepth } from "@/lib/jobs";
import { config } from "@/lib/config";
import { toolchain } from "@/lib/pipeline";

let cached: { at: number; tools: Awaited<ReturnType<typeof toolchain>> } | null = null;

// Whisper and its model only matter when this server transcribes.
const healthy = (t: Awaited<ReturnType<typeof toolchain>>) => t.ffmpeg && (!config.serverTranscribe || (t.whisper && t.model));

/** Liveness + readiness for Docker/uptime monitors. 503 if the database or toolchain is broken. */
export async function GET() {
  await connection();
  let dbOk = true;
  try {
    db.prepare("SELECT 1").get();
  } catch {
    dbOk = false;
  }
  // Cache only a fully healthy toolchain: a missing model (e.g. still downloading on first launch)
  // must show up as fixed the moment it lands, not a minute later.
  if (!cached || Date.now() - cached.at > 60_000) {
    const tools = await toolchain();
    cached = healthy(tools) ? { at: Date.now(), tools } : null;
    if (!cached) return Response.json({ ok: false, db: dbOk, ...tools, queue: dbOk ? queueDepth() : null, version: process.env.RECAP_VERSION ?? process.env.npm_package_version ?? null }, { status: 503 });
  }
  const ok = dbOk && healthy(cached.tools);
  return Response.json(
    { ok, db: dbOk, ...cached.tools, queue: dbOk ? queueDepth() : null, version: process.env.RECAP_VERSION ?? process.env.npm_package_version ?? null },
    { status: ok ? 200 : 503 },
  );
}
