import { createUser, signupOpen, startSession } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/ratelimit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const limited = rateLimit(`signup:${await clientIp()}`, 5, 60 * 60_000);
  if (limited) return limited;
  if (!signupOpen()) return Response.json({ error: "Sign-ups are closed on this server. Ask the admin for an account." }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const email = String(b.email ?? "").trim();
  const password = String(b.password ?? "");
  if (!EMAIL_RE.test(email)) return Response.json({ error: "Enter a valid email." }, { status: 400 });
  if (password.length < 10) return Response.json({ error: "Use at least 10 characters for the password." }, { status: 400 });
  if (password.length > 200) return Response.json({ error: "That password is too long." }, { status: 400 });

  try {
    const user = await createUser(email, password, String(b.name ?? "").slice(0, 80));
    await startSession(user.id);
    return Response.json(user, { status: 201 });
  } catch (err) {
    if (String((err as Error).message).includes("UNIQUE")) return Response.json({ error: "That email already has an account." }, { status: 409 });
    throw err;
  }
}
