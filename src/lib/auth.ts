import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies, headers } from "next/headers";
import { config } from "./config";
import { db, now } from "./db";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const SESSION_COOKIE = "recap_session";
const SESSION_DAYS = 30;

export interface User {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  emailVerified: boolean;
  /** "founder" (first FOUNDER_LIMIT verified cloud accounts) or "standard". */
  plan: string;
  founderNumber: number | null;
  notifyComments: boolean;
  notifyViews: boolean;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomId = (bytes = 12) => randomBytes(bytes).toString("base64url");

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(pw, salt, 64, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string) {
  const [alg, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(pw, Buffer.from(salt, "base64"), expected.length, SCRYPT);
  return timingSafeEqual(actual, expected);
}

type UserRow = {
  id: string; email: string; name: string; is_admin: number; email_verified_at: string | null; plan: string;
  founder_number: number | null; notify_comments: number; notify_views: number;
};
const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  isAdmin: !!r.is_admin,
  emailVerified: !!r.email_verified_at,
  plan: r.plan,
  founderNumber: r.founder_number,
  notifyComments: !!r.notify_comments,
  notifyViews: !!r.notify_views,
});

export function getUser(id: string): User | null {
  const r = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return r ? toUser(r) : null;
}

export function userCount() {
  return (db.prepare("SELECT count(*) AS n FROM users").get() as { n: number }).n;
}

/** Signup is open for the very first account (who becomes admin), then governed by ALLOW_SIGNUP. */
export const signupOpen = () => userCount() === 0 || config.allowSignup;

export async function createUser(email: string, password: string, name = "", { verified = !config.cloud } = {}) {
  const id = randomId();
  const first = userCount() === 0;
  // In Recap Cloud, accounts start unverified (double opt-in); the first account (the operator) never needs it.
  const verifiedAt = verified || first ? now() : null;
  db.prepare("INSERT INTO users (id, email, name, password_hash, is_admin, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    id, email.trim().toLowerCase(), name.trim(), await hashPassword(password), first ? 1 : 0, verifiedAt, now(),
  );
  // The first account adopts videos recorded before accounts existed (v0.1 data).
  if (first) db.prepare("UPDATE videos SET owner_id = ? WHERE owner_id IS NULL").run(id);
  return toUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow);
}

// ---- email verification, founding spots, password reset -------------------------------------

/** Single-use, expiring token for an emailed link. Only its hash is stored. */
export function issueEmailToken(userId: string, purpose: "verify" | "reset", ttlMs: number) {
  const token = randomId(32);
  db.prepare("DELETE FROM email_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL").run(userId, purpose);
  db.prepare("INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").run(
    sha256(token), userId, purpose, Date.now() + ttlMs, now(),
  );
  return token;
}

/** Returns the user id if the token is valid, unexpired and unused, and marks it used. */
export function consumeEmailToken(token: string, purpose: "verify" | "reset"): string | null {
  const row = db
    .prepare("SELECT user_id, expires_at, used_at FROM email_tokens WHERE token_hash = ? AND purpose = ?")
    .get(sha256(token), purpose) as { user_id: string; expires_at: number; used_at: string | null } | undefined;
  if (!row || row.used_at || row.expires_at < Date.now()) return null;
  db.prepare("UPDATE email_tokens SET used_at = ? WHERE token_hash = ?").run(now(), sha256(token));
  return row.user_id;
}

/**
 * Marks the email verified and, in Recap Cloud, hands out the next founding spot if any are left.
 * Runs in an IMMEDIATE transaction (plus a unique index on founder_number) so two verifications at the
 * same moment can never take the same spot or exceed the limit.
 */
export function markVerified(userId: string): User | null {
  db.exec("BEGIN IMMEDIATE");
  try {
    const u = db.prepare("SELECT email_verified_at, founder_number FROM users WHERE id = ?").get(userId) as
      | { email_verified_at: string | null; founder_number: number | null }
      | undefined;
    if (!u) {
      db.exec("ROLLBACK");
      return null;
    }
    if (!u.email_verified_at) db.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").run(now(), userId);
    if (config.cloud && u.founder_number === null) {
      const taken = (db.prepare("SELECT count(*) AS n FROM users WHERE founder_number IS NOT NULL").get() as { n: number }).n;
      if (taken < config.founderLimit) {
        db.prepare("UPDATE users SET founder_number = ?, plan = 'founder' WHERE id = ?").run(taken + 1, userId);
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return getUser(userId);
}

/** Public, real numbers for the founding offer (never inflated). */
export function founderStats() {
  const taken = (db.prepare("SELECT count(*) AS n FROM users WHERE founder_number IS NOT NULL").get() as { n: number }).n;
  return { limit: config.founderLimit, taken, left: Math.max(0, config.founderLimit - taken) };
}

export async function setPassword(userId: string, password: string) {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(password), userId);
  // A password change signs out every other session.
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function findUserByEmail(email: string): User | null {
  const r = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase()) as UserRow | undefined;
  return r ? toUser(r) : null;
}

export function setNotifications(userId: string, comments: boolean, views: boolean) {
  db.prepare("UPDATE users SET notify_comments = ?, notify_views = ? WHERE id = ?").run(comments ? 1 : 0, views ? 1 : 0, userId);
}

// ---- storage quotas ------------------------------------------------------------------------

export function storageUsed(userId: string) {
  return (db.prepare("SELECT coalesce(sum(size_bytes), 0) AS n FROM videos WHERE owner_id = ?").get(userId) as { n: number }).n;
}

/** Bytes this user may store, or null for unlimited (self-hosted servers, admins). */
export function quotaFor(user: User): number | null {
  if (!config.cloud || user.isAdmin) return null;
  return config.quotaBytes[user.plan] ?? config.quotaBytes.standard;
}

export async function checkLogin(email: string, password: string): Promise<User | null> {
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase()) as
    | (UserRow & { password_hash: string })
    | undefined;
  if (!row) {
    // Spend the same time as a real check so response timing doesn't reveal which emails exist.
    await hashPassword(password);
    return null;
  }
  return (await verifyPassword(password, row.password_hash)) ? toUser(row) : null;
}

export async function startSession(userId: string) {
  const token = randomId(32);
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(sha256(token), userId, expires, now());
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
    path: "/",
    expires: new Date(expires),
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) db.prepare("DELETE FROM sessions WHERE id = ?").run(sha256(token));
  jar.delete(SESSION_COOKIE);
}

/**
 * The signed-in user: from the session cookie (browser) or an `Authorization: Bearer` API token
 * (desktop apps). Null when anonymous.
 */
export async function currentUser(): Promise<User | null> {
  // Local mode: re-check the per-launch secret here too (proxy.ts skips the upload route).
  if (config.localToken) return (await localAuthorized()) ? localUser() : null;
  const auth = (await headers()).get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const hash = sha256(auth.slice(7).trim());
    const row = db
      .prepare("SELECT u.* FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?")
      .get(hash) as UserRow | undefined;
    if (row) db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?").run(now(), hash);
    return row ? toUser(row) : null;
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = db
    .prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?")
    .get(sha256(token), Date.now()) as UserRow | undefined;
  return row ? toUser(row) : null;
}

const LOCAL_EMAIL = "you@recap.local";

/** The single owner of everything in local mode (created on first use). */
function localUser(): User {
  let row = db.prepare("SELECT * FROM users WHERE email = ?").get(LOCAL_EMAIL) as UserRow | undefined;
  if (!row) {
    const id = randomId();
    // Unusable password: local mode never signs in with one.
    db.prepare("INSERT INTO users (id, email, name, password_hash, is_admin, email_verified_at, created_at) VALUES (?, ?, 'You', '!', 1, ?, ?)").run(id, LOCAL_EMAIL, now(), now());
    db.prepare("UPDATE videos SET owner_id = ? WHERE owner_id IS NULL").run(id);
    row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
  }
  return toUser(row);
}

export const isLocalMode = () => !!config.localToken;

/** Local mode: request is addressed to this machine and carries the launch secret (cookie or bearer). */
async function localAuthorized() {
  const h = await headers();
  const host = (h.get("host") ?? "").replace(/:\d+$/, "");
  if (host !== "127.0.0.1" && host !== "localhost") return false;
  const want = Buffer.from(config.localToken ?? "");
  const bearer = Buffer.from(h.get("authorization")?.replace(/^Bearer\s+/, "") ?? "");
  const cookie = Buffer.from((await cookies()).get("recap_local")?.value ?? "");
  const eq = (b: Buffer) => b.length === want.length && want.length > 0 && timingSafeEqual(b, want);
  return eq(bearer) || eq(cookie);
}

export const unauthorized = () => Response.json({ error: "Sign in required." }, { status: 401 });

// ---- API tokens for the desktop apps ------------------------------------------------

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export function createApiToken(userId: string, name: string) {
  const token = `rcp_${randomId(24)}`;
  const id = randomId(8);
  db.prepare("INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    id, userId, name.trim().slice(0, 60) || "Desktop app", sha256(token), token.slice(0, 8), now(),
  );
  return { id, token };
}

export function listApiTokens(userId: string): ApiToken[] {
  return (
    db.prepare("SELECT id, name, prefix, last_used_at, created_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC").all(userId) as {
      id: string; name: string; prefix: string; last_used_at: string | null; created_at: string;
    }[]
  ).map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, lastUsedAt: r.last_used_at, createdAt: r.created_at }));
}

export function revokeApiToken(userId: string, id: string) {
  return db.prepare("DELETE FROM api_tokens WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

/** Revokes the API token this request was made with (the desktop app disconnecting itself). */
export async function revokeCurrentToken() {
  const auth = (await headers()).get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  return db.prepare("DELETE FROM api_tokens WHERE token_hash = ?").run(sha256(auth.slice(7).trim())).changes > 0;
}
