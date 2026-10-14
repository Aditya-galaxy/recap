import { sendPasswordReset } from "@/lib/account-mail";
import { findUserByEmail } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/ratelimit";

/** Always answers the same way, so it can't be used to find out which emails have accounts. */
export async function POST(req: Request) {
  const limited = rateLimit(`forgot:${await clientIp()}`, 5, 60 * 60_000);
  if (limited) return limited;
  const b = await req.json().catch(() => ({}));
  const user = findUserByEmail(String(b.email ?? ""));
  if (user && user.email !== "you@recap.local") {
    const perEmail = rateLimit(`forgot-email:${user.id}`, 3, 60 * 60_000);
    if (!perEmail) await sendPasswordReset(user).catch((err) => console.error("[forgot] email failed:", err.message));
  }
  return Response.json({ ok: true });
}
