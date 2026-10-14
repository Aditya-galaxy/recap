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
  // v2: Recap Cloud — verified accounts, founding plan, comments, reactions, viewer insights, device sign-in.
  `
  ALTER TABLE users ADD COLUMN email_verified_at TEXT;
  ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'standard';
  ALTER TABLE users ADD COLUMN founder_number INTEGER;
  ALTER TABLE users ADD COLUMN notify_comments INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE users ADD COLUMN notify_views INTEGER NOT NULL DEFAULT 1;
  CREATE UNIQUE INDEX users_founder ON users(founder_number) WHERE founder_number IS NOT NULL;
  -- Accounts created before verification existed (self-hosted servers) count as verified.
  UPDATE users SET email_verified_at = created_at;

  CREATE TABLE email_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
    expires_at INTEGER NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );

  ALTER TABLE videos ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE videos ADD COLUMN first_view_notified INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    t REAL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX comments_video ON comments(video_id, created_at);

  CREATE TABLE reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    viewer TEXT NOT NULL,
    emoji TEXT NOT NULL,
    t REAL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX reactions_video ON reactions(video_id);

  CREATE TABLE view_sessions (
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    viewer TEXT NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    progress REAL NOT NULL DEFAULT 0,
    first_at TEXT NOT NULL,
    last_at TEXT NOT NULL,
    PRIMARY KEY (video_id, viewer)
  );

  CREATE TABLE device_codes (
    device_hash TEXT PRIMARY KEY,
    user_code TEXT NOT NULL UNIQUE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    token TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    client TEXT NOT NULL DEFAULT '',
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    reporter TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  // v3: moderation queue
  `
  ALTER TABLE reports ADD COLUMN resolved_at TEXT;
  ALTER TABLE reports ADD COLUMN resolution TEXT;
  CREATE INDEX reports_open ON reports(resolved_at, video_id);
  CREATE UNIQUE INDEX reports_once ON reports(video_id, reporter) WHERE resolved_at IS NULL;
  `,
  // v4: desktop app: where a local video was shared on Recap Cloud
  `
  ALTER TABLE videos ADD COLUMN cloud_url TEXT;
  ALTER TABLE videos ADD COLUMN cloud_version TEXT;
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
