import { currentUser, isLocalMode, unauthorized } from "@/lib/auth";
import { cloudLinkOf, share, shareProgress } from "@/lib/cloud-link";
import { readMeta } from "@/lib/store";

// Desktop app only: share a local video to the connected Recap Cloud account.

async function guard(id: string) {
  if (!isLocalMode()) return Response.json({ error: "not found" }, { status: 404 });
  if (!(await currentUser())) return unauthorized();
  if (!(await readMeta(id))) return Response.json({ error: "not found" }, { status: 404 });
  return null;
}

export async function GET(_req: Request, ctx: RouteContext<"/api/videos/[id]/share">) {
  const { id } = await ctx.params;
  const denied = await guard(id);
  if (denied) return denied;
  const link = cloudLinkOf(id);
  return Response.json({ progress: shareProgress(id), url: link?.cloud_url ?? null, version: link?.cloud_version ?? null });
}

/** { version: "original" | "clean" } */
export async function POST(req: Request, ctx: RouteContext<"/api/videos/[id]/share">) {
  const { id } = await ctx.params;
  const denied = await guard(id);
  if (denied) return denied;
  const b = await req.json().catch(() => ({}));
  try {
    await share(id, b.version === "clean" ? "clean" : "original");
    return Response.json({ progress: shareProgress(id) }, { status: 202 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 409 });
  }
}
