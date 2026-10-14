import "server-only";
import path from "node:path";

// Resolved at runtime only. Written so the bundler's file tracer doesn't treat these as static paths
// under the project root (which would copy the whole repo into the standalone build).
const inRoot = (...parts: string[]) => [process["cwd"](), ...parts].join(path.sep);

const bool = (v: string | undefined, fallback: boolean) =>
  v === undefined || v === "" ? fallback : ["1", "true", "yes", "on"].includes(v.toLowerCase());

export const config = {
  /** Everything persistent lives here: the SQLite database and video files. Mount this as a volume. */
  dataDir: process.env.DATA_DIR ?? inRoot("data"),
  whisperBin: process.env.WHISPER_BIN ?? "whisper-cli",
  ffmpegBin: process.env.FFMPEG_BIN ?? "ffmpeg",
  /**
   * Local mode: the desktop app runs this server on 127.0.0.1 for one person and passes a random
   * per-launch secret. No accounts; every request must carry the secret (see src/proxy.ts).
   */
  localToken: process.env.RECAP_LOCAL_TOKEN || null,
  whisperModel: process.env.WHISPER_MODEL ?? inRoot("models", "ggml-base.en.bin"),
  /** After the first (admin) account exists, can anyone else sign up? */
  allowSignup: bool(process.env.ALLOW_SIGNUP, true),
  /** If set, creating the first (admin) account requires this code, so a fresh public server can't be claimed by someone else. */
  setupCode: process.env.SETUP_CODE || null,
  /** Where the in-app feedback box sends messages. Set FEEDBACK_URL="" to hide the box. */
  feedbackUrl: process.env.FEEDBACK_URL ?? "https://recap.kronagent.dev/api/feedback",
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 4096) * 1024 * 1024,
  /** Absolute base URL for share links and link previews, e.g. https://recap.example.com. Optional. */
  publicUrl: process.env.PUBLIC_URL?.replace(/\/+$/, "") || null,
  /** Force the Secure flag on cookies. Defaults to on when PUBLIC_URL is https. */
  secureCookies: bool(process.env.SECURE_COOKIES, (process.env.PUBLIC_URL ?? "").startsWith("https://")),
};
