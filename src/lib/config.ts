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
  /** Desktop app: also show finished recordings here under readable names (hard links; see folder.ts). */
  namedDir: process.env.RECAP_NAMED_DIR || null,
  whisperModel: process.env.WHISPER_MODEL ?? inRoot("models", "ggml-base.en.bin"),
  /** Silero voice-activity model: whisper skips non-speech audio instead of inventing words in it. Optional. */
  vadModel: process.env.WHISPER_VAD_MODEL ?? inRoot("models", "ggml-silero-v5.1.2.bin"),
  /** After the first (admin) account exists, can anyone else sign up? */
  allowSignup: bool(process.env.ALLOW_SIGNUP, true),
  /** If set, creating the first (admin) account requires this code, so a fresh public server can't be claimed by someone else. */
  setupCode: process.env.SETUP_CODE || null,
  /** Where the in-app feedback box sends messages. Set FEEDBACK_URL="" to hide the box. */
  feedbackUrl: process.env.FEEDBACK_URL ?? "https://recap.kronagent.dev/api/feedback",
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 4096) * 1024 * 1024,
  /**
   * Run whisper on the server for uploads that arrive without a transcript. Small servers (e.g. a free-tier
   * VM) turn this off: the desktop app transcribes on the user's machine and uploads the transcript with the video.
   */
  serverTranscribe: bool(process.env.SERVER_TRANSCRIBE, true),
  /**
   * A Recap server (CLOUD_MODE) the desktop app can connect to for share links. Unset by default: the app is
   * fully local, and the connect / share-link UI only appears when this points at a server you run.
   */
  cloudUrl: process.env.RECAP_CLOUD_URL ? process.env.RECAP_CLOUD_URL.replace(/\/+$/, "") : null,
  /**
   * Recap Cloud mode (the hosted service): email verification is required, accounts get a plan
   * (founding / standard) with storage quotas, and the first FOUNDER_LIMIT verified accounts are founders.
   * Self-hosted servers leave this off and behave as before.
   */
  cloud: bool(process.env.CLOUD_MODE, false),
  founderLimit: Number(process.env.FOUNDER_LIMIT ?? 100),
  quotaBytes: {
    founder: Number(process.env.FOUNDER_QUOTA_GB ?? 25) * 1024 ** 3,
    standard: Number(process.env.STANDARD_QUOTA_GB ?? 2) * 1024 ** 3,
  } as Record<string, number>,
  /** Price shown for the paid plan once founding spots are gone (display only until billing ships). */
  paidPriceLabel: process.env.PAID_PRICE_LABEL ?? "$8/month",
  /** Transactional email (verification, password reset, notifications) via Resend. Unset = log to console. */
  resendApiKey: process.env.RESEND_API_KEY || null,
  // A domain verified in Resend (kronagent.com). Override with EMAIL_FROM.
  emailFrom: process.env.EMAIL_FROM ?? "Recap <recap@kronagent.com>",
  /** Shown on the Terms and Privacy pages as the way to reach the operator. */
  contactEmail: process.env.CONTACT_EMAIL || null,
  legalUpdated: process.env.LEGAL_UPDATED ?? "2026-10-14",
  /** Absolute base URL for share links and link previews, e.g. https://recap.example.com. Optional. */
  publicUrl: process.env.PUBLIC_URL?.replace(/\/+$/, "") || null,
  /** Force the Secure flag on cookies. Defaults to on when PUBLIC_URL is https. */
  secureCookies: bool(process.env.SECURE_COOKIES, (process.env.PUBLIC_URL ?? "").startsWith("https://")),
};
