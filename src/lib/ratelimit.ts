import "server-only";
import { headers } from "next/headers";

// Fixed-window counters in memory. Good enough for a single self-hosted instance.
const g = globalThis as unknown as { __recapRate?: Map<string, { count: number; reset: number }> };
const buckets = (g.__recapRate ??= new Map());

export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "local";
}

/** Returns a 429 Response when `key` has exceeded `limit` hits per `windowMs`, else null. */
export function rateLimit(key: string, limit: number, windowMs: number): Response | null {
  const t = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < t) {
    buckets.set(key, { count: 1, reset: t + windowMs });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.reset < t) buckets.delete(k);
    return null;
  }
  if (++b.count <= limit) return null;
  const retry = Math.ceil((b.reset - t) / 1000);
  return Response.json({ error: `Too many attempts. Try again in ${retry}s.` }, { status: 429, headers: { "Retry-After": String(retry) } });
}
