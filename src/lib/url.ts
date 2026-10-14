import "server-only";
import { headers } from "next/headers";
import { config } from "./config";

/** Absolute origin for share links and link previews: PUBLIC_URL, or whatever host the request came in on. */
export async function baseUrl() {
  if (config.publicUrl) return config.publicUrl;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3217";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
