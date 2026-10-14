import "server-only";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config";

// Schema migrations, applied in order and tracked with PRAGMA user_version.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,               -- sha256 of the cookie token
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE api_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    last_used_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE videos (
    id TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'unlisted' CHECK (visibility IN ('unlisted', 'private')),
    status TEXT NOT NULL,
    stage TEXT,
    error TEXT,
    duration REAL,
    width INTEGER,
    height INTEGER,
    clean_status TEXT NOT NULL DEFAULT 'none',
    clean_options TEXT,
    clean_duration REAL,
    clean_error TEXT,
    views INTEGER NOT NULL DEFAULT 0,
    size_bytes INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX videos_owner ON videos(owner_id, created_at DESC);
  CREATE TABLE jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    payload TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    run_after INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX jobs_pending ON jobs(status, run_after);
  `,
];

function open() {
  mkdirSync(config.dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(config.dataDir, "recap.db"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const { user_version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = user_version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  importLegacy(db);
  return db;
}

/** v0.1 stored metadata as data/videos/<id>/meta.json. Bring those in once; they get the first user as owner. */
function importLegacy(db: DatabaseSync) {
  const dir = path.join(config.dataDir, "videos");
  if (!existsSync(dir)) return;
  const insert = db.prepare(`INSERT OR IGNORE INTO videos
    (id, owner_id, title, status, error, duration, width, height, clean_status, clean_options, clean_duration, created_at)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const id of readdirSync(dir)) {
    const metaPath = path.join(dir, id, "meta.json");
    if (!existsSync(metaPath)) continue;
    try {
      const m = JSON.parse(readFileSync(metaPath, "utf8"));
      insert.run(
        m.id, m.title, m.status === "ready" ? "ready" : "error", m.error ?? null, m.duration ?? null, m.width ?? null,
        m.height ?? null, m.clean?.status === "ready" ? "ready" : "none",
        m.clean?.options ? JSON.stringify(m.clean.options) : null, m.clean?.duration ?? null, m.createdAt,
      );
    } catch (e) {
      console.warn(`[db] skipped legacy video ${id}:`, e);
    }
  }
}

// One connection per server process, opened on first use (never at import: `next build` imports
// route modules in parallel workers, and the build must not create a database at all).
const g = globalThis as unknown as { __recapDb?: DatabaseSync };
const conn = () => (g.__recapDb ??= open());

export const db = new Proxy({} as DatabaseSync, {
  get(_target, key) {
    const d = conn();
    const v = Reflect.get(d, key, d);
    return typeof v === "function" ? v.bind(d) : v;
  },
});

export const now = () => new Date().toISOString();
