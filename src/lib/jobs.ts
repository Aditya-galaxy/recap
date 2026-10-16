import "server-only";
import { db, now } from "./db";
import { makeGuide, polishGuide, readGuide, writeGuide } from "./guide";
import { PermanentError, processVideo, renderClean } from "./pipeline";
import { makeReport, polishReport, readReport, writeReport } from "./report";
import { updateMeta } from "./store";
import type { CleanOptions } from "./types";

// A small durable queue in SQLite. Jobs survive restarts; one worker runs them one at a time
// (whisper and ffmpeg already use every core, so parallel jobs would only thrash).

export type JobType = "process" | "clean" | "guide" | "polish" | "report" | "report-polish";
const MAX_ATTEMPTS = 3;
const POLL_MS = 1000;

type JobRow = { id: number; video_id: string; type: JobType; payload: string | null; attempts: number };

export function enqueue(type: JobType, videoId: string, payload?: unknown) {
  db.prepare("INSERT INTO jobs (video_id, type, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    videoId, type, payload === undefined ? null : JSON.stringify(payload), now(), now(),
  );
  startWorker();
  kick();
}

async function execute(job: JobRow) {
  if (job.type === "process") return processVideo(job.video_id);
  if (job.type === "clean") return renderClean(job.video_id, JSON.parse(job.payload ?? "{}") as CleanOptions);
  if (job.type === "guide") return makeGuide(job.video_id);
  if (job.type === "polish") return polishGuide(job.video_id);
  if (job.type === "report") return makeReport(job.video_id);
  if (job.type === "report-polish") return polishReport(job.video_id);
  throw new PermanentError(`unknown job type ${job.type}`);
}

/** Final failure: surface it on the video so the UI can show it. */
async function markFailed(job: JobRow, message: string) {
  if (job.type === "guide") {
    const g = await readGuide(job.video_id);
    if (g) await writeGuide(job.video_id, { ...g, status: "error", error: message }).catch(() => {});
    return;
  }
  if (job.type === "report" || job.type === "report-polish") {
    const r = await readReport(job.video_id);
    if (!r) return;
    if (job.type === "report") await writeReport(job.video_id, { ...r, status: "error", error: message }).catch(() => {});
    else {
      // A failed polish leaves the report as it was spoken.
      const back = r.polished ? r : { ...r, steps: r.steps.map((s) => ({ ...s, text: s.spoken ?? s.text })), ...(r.spoken ?? {}) };
      await writeReport(job.video_id, { ...back, status: "ready", progress: undefined, error: `Couldn't polish: ${message}` }).catch(() => {});
    }
    return;
  }
  if (job.type === "polish") {
    // A failed polish leaves the guide as it was (minus any half-finished rewrite).
    const g = await readGuide(job.video_id);
    if (g) {
      const steps = g.polished ? g.steps : g.steps.map((s) => ({ ...s, text: s.spoken ?? s.text }));
      await writeGuide(job.video_id, { ...g, steps, status: "ready", progress: undefined, error: `Couldn't polish: ${message}` }).catch(() => {});
    }
    return;
  }
  await updateMeta(job.video_id, (m) => {
    if (job.type === "process") {
      m.status = "error";
      m.error = message;
      delete m.stage;
    } else {
      m.clean = { ...m.clean, status: "error", error: message };
    }
  }).catch(() => {});
}

function claim(): JobRow | undefined {
  const job = db
    .prepare("SELECT id, video_id, type, payload, attempts FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY id LIMIT 1")
    .get(Date.now()) as JobRow | undefined;
  if (!job) return undefined;
  db.prepare("UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?").run(now(), job.id);
  return { ...job, attempts: job.attempts + 1 };
}

async function runOne(): Promise<boolean> {
  const job = claim();
  if (!job) return false;
  const started = Date.now();
  try {
    await execute(job);
    db.prepare("UPDATE jobs SET status = 'done', error = NULL, updated_at = ? WHERE id = ?").run(now(), job.id);
    console.log(`[jobs] ${job.type} ${job.video_id} done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    const permanent = err instanceof PermanentError || job.attempts >= MAX_ATTEMPTS;
    console.error(`[jobs] ${job.type} ${job.video_id} attempt ${job.attempts} failed${permanent ? " (giving up)" : ""}:`, message);
    if (permanent) {
      db.prepare("UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(message, now(), job.id);
      await markFailed(job, message);
    } else {
      // Back off 15s, 60s, ...
      const delay = 15_000 * 4 ** (job.attempts - 1);
      db.prepare("UPDATE jobs SET status = 'queued', error = ?, run_after = ?, updated_at = ? WHERE id = ?").run(message, Date.now() + delay, now(), job.id);
    }
  }
  return true;
}

const g = globalThis as unknown as { __recapWorker?: { busy: boolean; timer?: NodeJS.Timeout } };

async function kick() {
  const w = g.__recapWorker;
  if (!w || w.busy) return;
  w.busy = true;
  try {
    while (await runOne()) {
      /* drain */
    }
  } finally {
    w.busy = false;
  }
}

/** Idempotent. Called at server boot (instrumentation.ts) and lazily on enqueue. */
export function startWorker() {
  if (g.__recapWorker) return;
  g.__recapWorker = { busy: false };
  // Anything "running" when the process died was interrupted; run it again.
  const n = db.prepare("UPDATE jobs SET status = 'queued', run_after = 0, updated_at = ? WHERE status = 'running'").run(now()).changes;
  if (n) console.log(`[jobs] resuming ${n} interrupted job(s)`);
  g.__recapWorker.timer = setInterval(kick, POLL_MS);
  g.__recapWorker.timer.unref?.();
  kick();
}

export function queueDepth() {
  return (db.prepare("SELECT count(*) AS n FROM jobs WHERE status IN ('queued', 'running')").get() as { n: number }).n;
}
