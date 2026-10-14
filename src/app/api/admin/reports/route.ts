import { currentUser, unauthorized } from "@/lib/auth";
import { moderate, openReports, takenDown } from "@/lib/moderation";

async function admin() {
  const user = await currentUser();
  if (!user) return unauthorized();
  if (!user.isAdmin) return Response.json({ error: "Admins only." }, { status: 403 });
  return null;
}

export async function GET() {
  return (await admin()) ?? Response.json({ open: openReports(), takenDown: takenDown() });
}

/** { videoId, action: "takedown" | "restore" | "dismiss" } */
export async function POST(req: Request) {
  const denied = await admin();
  if (denied) return denied;
  const b = await req.json().catch(() => ({}));
  if (!["takedown", "restore", "dismiss"].includes(b.action)) return Response.json({ error: "Unknown action." }, { status: 400 });
  if (!(await moderate(String(b.videoId ?? ""), b.action))) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ open: openReports(), takenDown: takenDown() });
}
