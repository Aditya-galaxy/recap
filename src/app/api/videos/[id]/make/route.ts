import { currentUser, unauthorized } from "@/lib/auth";
import { enqueue } from "@/lib/jobs";
import { readMade, readVoice, writeMade, type BlurArea, type MakeFormat, type MakeOptions } from "@/lib/make";
import { isOwner, readMeta } from "@/lib/store";

export async function GET(_req: Request, ctx: RouteContext<"/api/videos/[id]/make">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return unauthorized();
  const meta = await readMeta(id);
  if (!meta || !isOwner(meta, user)) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ made: await readMade(id) });
}

export async function POST(req: Request, ctx: RouteContext<"/api/videos/[id]/make">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return unauthorized();
  const meta = await readMeta(id);
  if (!meta || !isOwner(meta, user)) return Response.json({ error: "not found" }, { status: 404 });
  if (meta.status !== "ready") return Response.json({ error: "Video is still processing." }, { status: 409 });
  if ((await readMade(id))?.status === "rendering") return Response.json({ error: "Already making one." }, { status: 409 });

  const b = await req.json().catch(() => ({}));
  const line = (v: unknown) => (typeof v === "string" ? v.slice(0, 120) : "");
  const num = (v: unknown, min: number, max: number) => Math.min(max, Math.max(min, Number(v) || 0));
  const blurs: BlurArea[] = (Array.isArray(b.blurs) ? b.blurs : []).slice(0, 40).map((a: Record<string, unknown>) => ({
    x: num(a.x, 0, 1), y: num(a.y, 0, 1), w: num(a.w, 0, 1), h: num(a.h, 0, 1),
    start: num(a.start, 0, 1e6), end: num(a.end, 0, 1e6),
  })).filter((a: BlurArea) => a.w > 0.002 && a.h > 0.002 && a.end > a.start);
  const clips: string[] = [];
  for (const c of Array.isArray(b.clips) ? b.clips.slice(0, 30) : []) {
    const clip = typeof c === "string" && c !== id ? await readMeta(c) : null;
    if (clip && isOwner(clip, user) && clip.status === "ready") clips.push(clip.id);
  }
  const audio = b.audio === "voice" || b.audio === "both" ? b.audio : "original";
  const voice = audio === "original" ? null : await readVoice(id);
  if (audio !== "original" && voice?.status !== "ready") return Response.json({ error: "Record a voice-over first." }, { status: 409 });
  const options: MakeOptions = {
    format: (["wide", "square", "vertical"] as MakeFormat[]).includes(b.format) ? b.format : "wide",
    captions: b.captions !== false,
    endCard: b.endCard !== false,
    endTitle: line(b.endTitle),
    endLink: line(b.endLink),
    small: b.small === true,
    // A voice-over is timed to the version it was recorded over.
    edited: voice ? voice.edited && meta.clean.status === "ready" : b.edited === true && meta.clean.status === "ready",
    intro: b.intro === true,
    introTitle: line(b.introTitle),
    introSubtitle: line(b.introSubtitle),
    clips,
    blurs,
    audio,
  };
  await writeMade(id, { status: "rendering", options });
  enqueue("make", id, options);
  return Response.json({ ok: true }, { status: 202 });
}
