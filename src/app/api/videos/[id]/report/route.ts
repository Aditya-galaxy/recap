import { promises as fs } from "node:fs";
import { currentUser, unauthorized } from "@/lib/auth";
import { enqueue } from "@/lib/jobs";
import { readReport, REPORT_IMAGE_RE, reportHtml, reportImagePath, reportMarkdown, writeReport, type Report } from "@/lib/report";
import { canView, isOwner, readMeta } from "@/lib/store";

const fileName = (title: string, ext: string) => {
  const name = `${title.replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").trim().slice(0, 120) || "Bug report"} – bug report.${ext}`;
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};

/** The report (JSON), one of its screenshots (?image=), or an export (?format=html|md). */
export async function GET(req: Request, ctx: RouteContext<"/api/videos/[id]/report">) {
  const { id } = await ctx.params;
  const meta = await readMeta(id);
  if (!meta || !canView(meta, await currentUser())) return Response.json({ error: "not found" }, { status: 404 });
  const url = new URL(req.url);
  const image = url.searchParams.get("image");
  if (image) {
    if (!REPORT_IMAGE_RE.test(image)) return new Response("not found", { status: 404 });
    const data = await fs.readFile(reportImagePath(id, image)).catch(() => null);
    if (!data) return new Response("not found", { status: 404 });
    return new Response(new Uint8Array(data), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" } });
  }
  const r = await readReport(id);
  const format = url.searchParams.get("format");
  if (format === "html" || format === "md") {
    if (r?.status !== "ready") return Response.json({ error: "No report yet." }, { status: 404 });
    return format === "html"
      ? new Response(await reportHtml(id, r), { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": fileName(r.title, "html") } })
      : new Response(reportMarkdown(r, `${meta.title}.mp4`), { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": fileName(r.title, "md") } });
  }
  return Response.json({ report: r });
}

/** Make (or remake) the report from the recording. */
export async function POST(_req: Request, ctx: RouteContext<"/api/videos/[id]/report">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return unauthorized();
  const meta = await readMeta(id);
  if (!meta || !isOwner(meta, user)) return Response.json({ error: "not found" }, { status: 404 });
  if (meta.status !== "ready") return Response.json({ error: "Video is still processing." }, { status: 409 });
  const r = await readReport(id);
  if (r?.status === "making" || r?.status === "polishing") return Response.json({ error: "Already working on the report." }, { status: 409 });
  const next: Report = { status: "making", title: r?.title ?? meta.title, steps: r?.steps ?? [], expected: "", actual: "", environment: [], updatedAt: new Date().toISOString() };
  await writeReport(id, next);
  enqueue("report", id);
  return Response.json({ report: next }, { status: 202 });
}

/** Save edits. Steps can only reference screenshots the report already has. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/videos/[id]/report">) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return unauthorized();
  const meta = await readMeta(id);
  if (!meta || !isOwner(meta, user)) return Response.json({ error: "not found" }, { status: 404 });
  const r = await readReport(id);
  if (r?.status !== "ready") return Response.json({ error: "No report to edit." }, { status: 409 });
  const b = await req.json().catch(() => null);
  if (!b || !Array.isArray(b.steps)) return Response.json({ error: "Bad request." }, { status: 400 });
  const str = (v: unknown, max: number, fallback: string) => (typeof v === "string" ? v.slice(0, max) : fallback);
  const known = new Map(r.steps.map((s) => [s.image, s]));
  const steps = (b.steps as { image?: unknown; text?: unknown }[])
    .filter((x) => typeof x?.image === "string" && known.has(x.image as string))
    .map((x) => ({ ...known.get(x.image as string)!, text: str(x.text, 2000, "") }));
  let next: Report = {
    ...r,
    title: typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 200) : r.title,
    steps,
    expected: str(b.expected, 4000, r.expected),
    actual: str(b.actual, 4000, r.actual),
    environment: Array.isArray(b.environment) ? b.environment.filter((e: unknown) => typeof e === "string").slice(0, 20).map((e: string) => e.slice(0, 300)) : r.environment,
    updatedAt: new Date().toISOString(),
  };
  // Undo an AI polish: the client sends back what was said; forget the polish bookkeeping.
  if (b.polished === false) next = { ...next, polished: false, spoken: undefined, steps: next.steps.map((st) => ({ t: st.t, text: st.text, image: st.image })) };
  await writeReport(id, next);
  return Response.json({ report: next });
}
