// recap.kronagent.dev: the public front door for Recap. Serves the landing page and collects
// email signups into Firestore. Runs on Cloud Run (scales to zero); no framework, one dependency.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FieldValue, Firestore } from "@google-cloud/firestore";

const PORT = Number(process.env.PORT ?? 8080);
const COLLECTION = process.env.SIGNUP_COLLECTION ?? "signups";
// A dedicated Firestore database, so signups are isolated from other apps in the project.
const DATABASE = process.env.FIRESTORE_DATABASE ?? "recap";
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");

// Uses the Cloud Run service account; locally, Application Default Credentials (or set DRY_RUN=1).
const db = process.env.DRY_RUN ? null : new Firestore({ databaseId: DATABASE, ignoreUndefinedProperties: true });

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

// Strip control characters (keeps newlines/tabs in messages) so stored text can't carry terminal escapes.
const clean = (v, max) => String(v ?? "").replace(/[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, "").slice(0, max);

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

// The client's address as seen by Google's front end, which appends it as the LAST X-Forwarded-For entry.
// Earlier entries are whatever the client sent, so trusting the first one let anyone dodge rate limits.
const clientIp = (req) => {
  const hops = String(req.headers["x-forwarded-for"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return hops.at(-1) || req.socket.remoteAddress || "?";
};

// Per-instance fixed-window limiter; good enough to stop casual abuse of a signup form.
const hits = new Map();
function limited(ip, limit = 5, windowMs = 10 * 60_000) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < now) {
    hits.set(ip, { n: 1, reset: now + windowMs });
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return false;
  }
  return ++h.n > limit;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { "Content-Type": "application/json", "Cache-Control": "no-store" });

async function readBody(req, max = 4096) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > max) throw new Error("too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function subscribe(req, res) {
  const ip = clientIp(req);
  if (limited(ip)) return json(res, 429, { error: "Too many attempts. Try again in a few minutes." });

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: "Bad request." });
  }
  // Honeypot: real people never see or fill this field.
  if (body.website) return json(res, 200, { ok: true });

  const email = String(body.email ?? "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return json(res, 400, { error: "Enter a valid email address." });

  const doc = {
    email,
    interest: ["download", "desktop", "hosted", "selfhost"].includes(body.interest) ? body.interest : "desktop",
    os: ["mac", "mac-intel", "windows", "linux", "other"].includes(body.os) ? body.os : undefined,
    source: clean(body.source, 80) || undefined,
    referrer: clean(req.headers.referer, 300) || undefined,
    userAgent: clean(req.headers["user-agent"], 300) || undefined,
    lastSeenAt: FieldValue.serverTimestamp(),
    signups: FieldValue.increment(1),
  };
  try {
    if (db) {
      // One document per address (keyed by its hash), so repeat signups just update it.
      const ref = db.collection(COLLECTION).doc(createHash("sha256").update(email).digest("hex"));
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        tx.set(ref, snap.exists ? doc : { ...doc, createdAt: FieldValue.serverTimestamp() }, { merge: true });
      });
    } else {
      console.log("[dry-run] signup", email, doc.interest, doc.os ?? "");
    }
  } catch (err) {
    console.error("signup failed", err);
    return json(res, 500, { error: "Something went wrong. Please try again." });
  }
  // Same answer whether or not the address was already on the list.
  return json(res, 200, { ok: true });
}

// Feedback from the landing page and from inside the app (self-hosted servers and the desktop app
// post here cross-origin, so this endpoint allows any origin and takes no credentials).
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" };
const KINDS = ["bug", "idea", "praise", "other"];

async function feedback(req, res) {
  const reply = (status, obj) => send(res, status, JSON.stringify(obj), { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS });
  const ip = clientIp(req);
  if (limited(`fb:${ip}`, 8, 60 * 60_000)) return reply(429, { error: "Too much feedback from here for now. Try again later." });

  let body;
  try {
    body = JSON.parse(await readBody(req, 16_384));
  } catch {
    return reply(400, { error: "Bad request." });
  }
  if (body.website) return reply(200, { ok: true }); // honeypot
  const message = String(body.message ?? "").trim();
  if (message.length < 3) return reply(400, { error: "Write a few words first." });
  const email = String(body.email ?? "").trim().toLowerCase();
  if (email && (email.length > 254 || !EMAIL_RE.test(email))) return reply(400, { error: "That email doesn't look right (it's optional)." });

  const doc = {
    message: clean(message, 4000),
    kind: KINDS.includes(body.kind) ? body.kind : "other",
    email: email || undefined,
    where: ["site", "web", "desktop", "mac"].includes(body.where) ? body.where : "site",
    version: clean(body.version, 40) || undefined,
    page: clean(body.page, 200) || undefined,
    userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300) || undefined,
    createdAt: FieldValue.serverTimestamp(),
  };
  try {
    if (db) await db.collection("feedback").add(doc);
    else console.log("[dry-run] feedback", doc.kind, doc.where, doc.message.slice(0, 60));
  } catch (err) {
    console.error("feedback failed", err);
    return reply(500, { error: "Something went wrong. Please try again." });
  }
  return reply(200, { ok: true });
}

async function serveStatic(req, res, pathname) {
  const file = pathname === "/" ? "index.html" : pathname.slice(1);
  const full = path.join(PUBLIC, path.normalize(file));
  if (!full.startsWith(PUBLIC + path.sep)) return send(res, 404, "Not found");
  try {
    const data = await readFile(full);
    const ext = path.extname(full);
    const cache = ext === ".html" ? "public, max-age=300" : "public, max-age=86400";
    send(res, 200, req.method === "HEAD" ? undefined : data, { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": cache });
  } catch {
    send(res, 404, "Not found", { "Content-Type": "text/plain" });
  }
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://x");
  try {
    if (pathname === "/api/subscribe" && req.method === "POST") return await subscribe(req, res);
    if (pathname === "/api/feedback" && req.method === "OPTIONS") return send(res, 204, undefined, CORS);
    if (pathname === "/api/feedback" && req.method === "POST") return await feedback(req, res);
    if (pathname === "/api/health") return json(res, 200, { ok: true });
    if (req.method === "GET" || req.method === "HEAD") return await serveStatic(req, res, pathname);
    send(res, 405, "Method not allowed");
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, "Server error");
  }
}).listen(PORT, () => console.log(`recap-site listening on :${PORT}`));
