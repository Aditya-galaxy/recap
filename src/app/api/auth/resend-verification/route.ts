import { sendVerification } from "@/lib/account-mail";
import { currentUser, unauthorized } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";

export async function POST() {
  const user = await currentUser();
  if (!user) return unauthorized();
  if (user.emailVerified) return Response.json({ ok: true, alreadyVerified: true });
  const limited = rateLimit(`resend-verify:${user.id}`, 3, 60 * 60_000);
  if (limited) return limited;
  await sendVerification(user);
  return Response.json({ ok: true });
}
