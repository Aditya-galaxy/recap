import { checkLogin, currentUser, endSession, setNotifications, unauthorized } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { deleteVideo } from "@/lib/store";

/** Lets the desktop apps verify their server URL + token ("connected as …"). */
export async function GET() {
  const user = await currentUser();
  return user ? Response.json(user) : unauthorized();
}

/** Notification preferences. */
export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const b = await req.json().catch(() => ({}));
  setNotifications(
    user.id,
    typeof b.notifyComments === "boolean" ? b.notifyComments : user.notifyComments,
    typeof b.notifyViews === "boolean" ? b.notifyViews : user.notifyViews,
  );
  return Response.json({ ok: true });
}

/** Deletes the account and every video it owns. Requires the password. */
export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const limited = rateLimit(`delete-account:${await clientIp()}`, 5, 60 * 60_000);
  if (limited) return limited;
  const b = await req.json().catch(() => ({}));
  if (!(await checkLogin(user.email, String(b.password ?? "")))) return Response.json({ error: "Wrong password." }, { status: 403 });
  const owned = db.prepare("SELECT id FROM videos WHERE owner_id = ?").all(user.id) as { id: string }[];
  for (const v of owned) await deleteVideo(v.id);
  db.prepare("DELETE FROM users WHERE id = ?").run(user.id); // sessions, tokens, comments cascade
  await endSession();
  return new Response(null, { status: 204 });
}
