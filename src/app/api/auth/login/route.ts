import { checkLogin, startSession } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export async function POST(req: Request) {
  const limited = rateLimit(`login:${await clientIp()}`, 10, 15 * 60_000);
  if (limited) return limited;
  const b = await req.json().catch(() => ({}));
  const user = await checkLogin(String(b.email ?? ""), String(b.password ?? ""));
  if (!user) return Response.json({ error: "Wrong email or password." }, { status: 401 });
  await startSession(user.id);
  return Response.json(user);
}
