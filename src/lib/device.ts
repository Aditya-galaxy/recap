import "server-only";
import { createHash, randomInt } from "node:crypto";
import { createApiToken, randomId, type User } from "./auth";
import { db, now } from "./db";

// "Connect to Recap Cloud" for the desktop app, modelled on the OAuth device flow (RFC 8628): the app asks
// for a code, the person approves it in their signed-in browser, and the app's next poll receives an API
// token. The app never sees the password, and the token can be revoked from settings.

const TTL_MS = 10 * 60_000;
export const POLL_SECONDS = 3;
const ALPHABET = "BCDFGHJKLMNPQRSTVWXZ"; // no vowels (no accidental words), nothing that looks like a digit
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export function normalizeUserCode(code: string) {
  const c = code.toUpperCase().replace(/[^A-Z]/g, "");
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : null;
}

export function startDevice(client: string) {
  db.prepare("DELETE FROM device_codes WHERE expires_at < ?").run(Date.now());
  const deviceCode = randomId(32);
  const userCode = Array.from({ length: 8 }, (_, i) => (i === 4 ? "-" : "") + ALPHABET[randomInt(ALPHABET.length)]).join("");
  db.prepare("INSERT INTO device_codes (device_hash, user_code, status, client, expires_at, created_at) VALUES (?, ?, 'pending', ?, ?, ?)").run(
    hash(deviceCode), userCode, client.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 60) || "Recap desktop", Date.now() + TTL_MS, now(),
  );
  return { deviceCode, userCode, expiresIn: TTL_MS / 1000, interval: POLL_SECONDS };
}

/** The pending request a person is looking at on /connect, or null if it's unknown, used or expired. */
export function pendingRequest(userCode: string) {
  const code = normalizeUserCode(userCode);
  if (!code) return null;
  const r = db.prepare("SELECT client, expires_at FROM device_codes WHERE user_code = ? AND status = 'pending'").get(code) as
    | { client: string; expires_at: number }
    | undefined;
  return r && r.expires_at > Date.now() ? { userCode: code, client: r.client } : null;
}

export function decide(userCode: string, user: User, approve: boolean): boolean {
  const req = pendingRequest(userCode);
  if (!req) return false;
  if (!approve) {
    db.prepare("UPDATE device_codes SET status = 'denied' WHERE user_code = ?").run(req.userCode);
    return true;
  }
  const { token } = createApiToken(user.id, req.client);
  // Held only until the app's next poll picks it up (seconds), then the row is deleted.
  return (
    db.prepare("UPDATE device_codes SET status = 'approved', user_id = ?, token = ? WHERE user_code = ? AND status = 'pending'").run(user.id, token, req.userCode)
      .changes > 0
  );
}

export type PollResult =
  | { status: "pending" | "denied" | "expired" }
  | { status: "approved"; token: string; email: string; name: string };

export function poll(deviceCode: string): PollResult {
  const h = hash(deviceCode);
  const r = db
    .prepare("SELECT d.status, d.token, d.expires_at, u.email, u.name FROM device_codes d LEFT JOIN users u ON u.id = d.user_id WHERE d.device_hash = ?")
    .get(h) as { status: string; token: string | null; expires_at: number; email: string | null; name: string | null } | undefined;
  if (!r) return { status: "expired" };
  if (r.status === "approved" && r.token) {
    db.prepare("DELETE FROM device_codes WHERE device_hash = ?").run(h);
    return { status: "approved", token: r.token, email: r.email ?? "", name: r.name ?? "" };
  }
  if (r.status === "denied") {
    db.prepare("DELETE FROM device_codes WHERE device_hash = ?").run(h);
    return { status: "denied" };
  }
  return r.expires_at < Date.now() ? { status: "expired" } : { status: "pending" };
}
