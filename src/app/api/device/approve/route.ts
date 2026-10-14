import { headers } from "next/headers";
import { currentUser, unauthorized } from "@/lib/auth";
import { decide } from "@/lib/device";
import { clientIp, rateLimit } from "@/lib/ratelimit";

/** Step 2 (browser): the signed-in person approves or denies the code shown in their desktop app. */
export async function POST(req: Request) {
  // Browser sessions only: an API token must not be able to mint more tokens.
  if ((await headers()).get("authorization")) return Response.json({ error: "Approve from your browser." }, { status: 403 });
  const user = await currentUser();
  if (!user) return unauthorized();
  if (!user.emailVerified) return Response.json({ error: "Confirm your email first." }, { status: 403 });
  const limited = rateLimit(`device-approve:${await clientIp()}`, 20, 10 * 60_000);
  if (limited) return limited;
  const b = await req.json().catch(() => ({}));
  if (!decide(String(b.userCode ?? ""), user, b.approve === true)) {
    return Response.json({ error: "That code is wrong or has expired. Start again from the app." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
