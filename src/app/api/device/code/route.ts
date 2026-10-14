import { startDevice } from "@/lib/device";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { baseUrl } from "@/lib/url";

/** Step 1 (desktop app): get a code for the person to approve in their browser. */
export async function POST(req: Request) {
  const limited = rateLimit(`device:${await clientIp()}`, 20, 60 * 60_000);
  if (limited) return limited;
  const b = await req.json().catch(() => ({}));
  const d = startDevice(String(b.client ?? ""));
  const url = `${await baseUrl()}/connect`;
  return Response.json({ ...d, verifyUrl: url, verifyUrlComplete: `${url}?code=${d.userCode}` });
}
