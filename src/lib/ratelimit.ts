import "server-only";
import { headers } from "next/headers";

// Fixed-window counters in memory. Good enough for a single self-hosted instance.
const g = globalThis as unknown as { __recapRate?: Map<string, { count: number; reset: number }> };
const buckets = (g.__recapRate ??= new Map());

/**
 * The client's address for rate limiting. Proxies (Caddy, Cloud Run, nginx) append the address they saw
 * as the LAST X-Forwarded-For entry; anything before it is client-supplied and spoofable (trusting the
 * first entry let anyone bypass every limit). TRUSTED_PROXY_HOPS=N picks the Nth-from-last when several
 * proxies are chained.
 */
export async function clientIp() {
  const h = await headers();
  const hops = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const n = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS) || 1);
  return hops.at(-n) ?? hops[0] ?? h.get("x-real-ip") ?? "local";
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
