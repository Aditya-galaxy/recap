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

type UserRow = { id: string; email: string; name: string; is_admin: number };
const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, name: r.name, isAdmin: !!r.is_admin });

export function userCount() {
  return (db.prepare("SELECT count(*) AS n FROM users").get() as { n: number }).n;
}

/** Signup is open for the very first account (who becomes admin), then governed by ALLOW_SIGNUP. */
export const signupOpen = () => userCount() === 0 || config.allowSignup;

export async function createUser(email: string, password: string, name = "") {
  const id = randomId();
  const first = userCount() === 0;
  db.prepare("INSERT INTO users (id, email, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    id, email.trim().toLowerCase(), name.trim(), await hashPassword(password), first ? 1 : 0, now(),
  );
  // The first account adopts videos recorded before accounts existed (v0.1 data).
  if (first) db.prepare("UPDATE videos SET owner_id = ? WHERE owner_id IS NULL").run(id);
  return toUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow);
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
