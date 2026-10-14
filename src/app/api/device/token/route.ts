import { poll } from "@/lib/device";
import { rateLimit } from "@/lib/ratelimit";

/** Step 3 (desktop app): poll until the person approves; the response then carries the API token, once. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const deviceCode = String(b.deviceCode ?? "");
  if (!deviceCode) return Response.json({ error: "Missing deviceCode." }, { status: 400 });
  // A 3 s poll over the 10-minute lifetime is 200 requests; the code itself is 256 random bits.
  const limited = rateLimit(`device-poll:${deviceCode}`, 300, 10 * 60_000);
  if (limited) return limited;
  return Response.json(poll(deviceCode), { headers: { "Cache-Control": "no-store" } });
}
