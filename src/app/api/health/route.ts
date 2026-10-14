import { connection } from "next/server";
import { db } from "@/lib/db";
import { queueDepth } from "@/lib/jobs";
import { toolchain } from "@/lib/pipeline";

let cached: { at: number; tools: Awaited<ReturnType<typeof toolchain>> } | null = null;

/** Liveness + readiness for Docker/uptime monitors. 503 if the database or toolchain is broken. */
export async function GET() {
  await connection();
  let dbOk = true;
  try {
    db.prepare("SELECT 1").get();
  } catch {
    dbOk = false;
  }
  if (!cached || Date.now() - cached.at > 60_000) cached = { at: Date.now(), tools: await toolchain() };
  const ok = dbOk && cached.tools.ffmpeg && cached.tools.whisper && cached.tools.model;
  return Response.json(
    { ok, db: dbOk, ...cached.tools, queue: dbOk ? queueDepth() : null, version: process.env.RECAP_VERSION ?? process.env.npm_package_version ?? null },
    { status: ok ? 200 : 503 },
  );
}
