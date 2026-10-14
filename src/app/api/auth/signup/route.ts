import { timingSafeEqual } from "node:crypto";
import { createUser, signupOpen, startSession, userCount } from "@/lib/auth";
import { sendVerification } from "@/lib/account-mail";
import { config } from "@/lib/config";
import { clientIp, rateLimit } from "@/lib/ratelimit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const limited = rateLimit(`signup:${await clientIp()}`, 5, 60 * 60_000);
  if (limited) return limited;
  if (!signupOpen()) return Response.json({ error: "Sign-ups are closed on this server. Ask the admin for an account." }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  if (config.setupCode && userCount() === 0) {
    const given = Buffer.from(String(b.setupCode ?? ""));
    const want = Buffer.from(config.setupCode);
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      return Response.json({ error: "Wrong setup code. It's the SETUP_CODE the server was started with." }, { status: 403 });
    }
  }
  const email = String(b.email ?? "").trim();
  const password = String(b.password ?? "");
  if (!EMAIL_RE.test(email)) return Response.json({ error: "Enter a valid email." }, { status: 400 });
  if (password.length < 10) return Response.json({ error: "Use at least 10 characters for the password." }, { status: 400 });
  if (password.length > 200) return Response.json({ error: "That password is too long." }, { status: 400 });

  try {
    const user = await createUser(email, password, String(b.name ?? "").slice(0, 80));
    await startSession(user.id);
    // Double opt-in: unverified accounts can sign in but can't upload until they confirm.
    if (!user.emailVerified) {
      try {
        await sendVerification(user);
      } catch (err) {
        console.error("[signup] verification email failed:", (err as Error).message);
        return Response.json({ ...user, verificationSent: false }, { status: 201 });
      }
    }
    return Response.json({ ...user, verificationSent: !user.emailVerified }, { status: 201 });
  } catch (err) {
    if (String((err as Error).message).includes("UNIQUE")) return Response.json({ error: "That email already has an account." }, { status: 409 });
    throw err;
  }
}
