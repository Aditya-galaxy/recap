import { consumeEmailToken, markVerified, setPassword, startSession } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export async function POST(req: Request) {
  const limited = rateLimit(`reset:${await clientIp()}`, 10, 60 * 60_000);
  if (limited) return limited;
  const b = await req.json().catch(() => ({}));
  const password = String(b.password ?? "");
  if (password.length < 10) return Response.json({ error: "Use at least 10 characters for the password." }, { status: 400 });
  if (password.length > 200) return Response.json({ error: "That password is too long." }, { status: 400 });
  const userId = consumeEmailToken(String(b.token ?? ""), "reset");
  if (!userId) return Response.json({ error: "This reset link is invalid or has expired. Request a new one." }, { status: 400 });
  await setPassword(userId, password);
  // Receiving the reset email proves the address, so this also verifies it.
  markVerified(userId);
  await startSession(userId);
  return Response.json({ ok: true });
}
