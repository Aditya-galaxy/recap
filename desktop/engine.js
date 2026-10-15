// The local Recap engine: the same server as the self-hosted version (library, transcription,
// clean-up), run inside the desktop app on 127.0.0.1 with bundled ffmpeg + whisper.cpp.
const { app, utilityProcess } = require("electron");
const { EventEmitter } = require("node:events");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const MODEL_NAME = "base.en";
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL_NAME}.bin`;
const MODEL_MIN_BYTES = 100 * 1024 * 1024;

const exe = (name) => (process.platform === "win32" ? `${name}.exe` : name);
// Packaged: Contents/Resources/{engine,bin}. Development: desktop/{engine,bin}.
const resources = () => (app.isPackaged ? process.resourcesPath : __dirname);
const engineDir = () => path.join(resources(), "engine");

/** Bundled binary, or the same name on PATH (development fallback). */
function bin(name) {
  const p = path.join(resources(), "bin", exe(name));
  return fs.existsSync(p) ? p : name;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

class Engine extends EventEmitter {
  constructor() {
    super();
    this.state = "stopped"; // stopped | starting | ready | error
    this.error = "";
    this.url = "";
    this.token = "";
    this.model = { state: "unknown", progress: 0, error: "" }; // unknown | downloading | ready | error
    this.proc = null;
    this.crashes = [];
    this.stopping = false;
  }

  get dataDir() {
    // The self-test gets its own throwaway library; it must never touch a real one.
    if (process.env.RECAP_SELFTEST) return path.join(process.env.RECAP_SELFTEST, "library");
    // Development: a scratch home so trying a build never migrates or touches the real library.
    if (process.env.RECAP_DEV_HOME) return path.join(process.env.RECAP_DEV_HOME, "library");
    return path.join(app.getPath("videos"), "Recap", "library");
  }

  get modelPath() {
    return path.join(app.getPath("userData"), "models", `ggml-${MODEL_NAME}.bin`);
  }

  status() {
    return { state: this.state, error: this.error, model: this.model, dataDir: this.dataDir };
  }

  set(patch) {
    Object.assign(this, patch);
    this.emit("status", this.status());
  }

  async start() {
    if (this.state === "starting" || this.state === "ready") return;
    this.stopping = false;
    const serverJs = path.join(engineDir(), "server.js");
    if (!fs.existsSync(serverJs)) {
      return this.set({ state: "error", error: "The Recap engine is missing from this build." });
    }
    this.set({ state: "starting", error: "" });
    const port = await freePort();
    this.token = randomBytes(32).toString("hex");
    this.url = `http://127.0.0.1:${port}`;
    fs.mkdirSync(this.dataDir, { recursive: true });

    const logPath = path.join(app.getPath("userData"), "engine.log");
    try {
      if (fs.statSync(logPath).size > 5 * 1024 * 1024) fs.rmSync(logPath);
    } catch {}
    const log = fs.createWriteStream(logPath, { flags: "a" });
    log.write(`\n== engine start ${new Date().toISOString()} port ${port}\n`);

    this.proc = utilityProcess.fork(serverJs, [], {
      cwd: engineDir(),
      serviceName: "Recap engine",
      stdio: "pipe",
      env: {
        ...process.env,
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
        DATA_DIR: this.dataDir,
        RECAP_LOCAL_TOKEN: this.token,
        RECAP_VERSION: app.getVersion(),
        FFMPEG_BIN: bin("ffmpeg"),
        WHISPER_BIN: bin("whisper-cli"),
        WHISPER_MODEL: this.modelPath,
        // Local library: no upload cap (a 2-hour 1080p recording is ~7 GB).
        MAX_UPLOAD_MB: "1000000",
        FEEDBACK_URL: process.env.FEEDBACK_URL ?? "https://recap.kronagent.dev/api/feedback",
      },
    });
    this.proc.stdout?.pipe(log);
    this.proc.stderr?.pipe(log);
    this.proc.on("exit", (code) => {
      log.write(`== engine exit ${code}\n`);
      this.proc = null;
      if (this.stopping) return this.set({ state: "stopped" });
      // Crashed: restart, unless it keeps crashing.
      const now = Date.now();
      this.crashes = [...this.crashes.filter((t) => now - t < 60_000), now];
      if (this.crashes.length > 3) {
        return this.set({ state: "error", error: `The Recap engine keeps stopping. Details: ${logPath}` });
      }
      this.set({ state: "stopped" });
      setTimeout(() => this.start(), 1500);
    });

    // Ready when it answers the health check (503 just means the model isn't downloaded yet).
    for (let i = 0; i < 100; i++) {
      try {
        const res = await fetch(`${this.url}/api/health`, { headers: { Authorization: `Bearer ${this.token}` } });
        if (res.status === 200 || res.status === 503) return this.set({ state: "ready" });
      } catch {}
      if (!this.proc) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    this.set({ state: "error", error: `The Recap engine didn't start. Details: ${logPath}` });
  }

  stop() {
    this.stopping = true;
    this.proc?.kill();
  }

  /** Downloads the Whisper model once, into the app's data folder. */
  async ensureModel() {
    if (this.model.state === "downloading") return;
    try {
      if (fs.statSync(this.modelPath).size > MODEL_MIN_BYTES) {
        return this.set({ model: { state: "ready", progress: 1, error: "" } });
      }
    } catch {}
    this.set({ model: { state: "downloading", progress: 0, error: "" } });
    const part = `${this.modelPath}.part`;
    try {
      fs.mkdirSync(path.dirname(this.modelPath), { recursive: true });
      const res = await fetch(MODEL_URL);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get("content-length")) || 0;
      let got = 0;
      let last = 0;
      const body = Readable.fromWeb(res.body);
      body.on("data", (c) => {
        got += c.length;
        const p = total ? got / total : 0;
        if (p - last > 0.01) {
          last = p;
          this.set({ model: { state: "downloading", progress: p, error: "" } });
        }
      });
      await pipeline(body, fs.createWriteStream(part));
      if (fs.statSync(part).size < MODEL_MIN_BYTES) throw new Error("download was incomplete");
      fs.renameSync(part, this.modelPath);
      this.set({ model: { state: "ready", progress: 1, error: "" } });
    } catch (err) {
      fs.rmSync(part, { force: true });
      this.set({ model: { state: "error", progress: 0, error: `Couldn't download the transcription model (${err.cause?.code ?? err.message}).` } });
    }
  }
}

module.exports = { engine: new Engine(), bin };
