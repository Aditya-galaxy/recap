// Recap desktop: local-first. Recording, transcription and clean-up all run on this computer via the
// bundled engine (engine.js). Optionally, recordings can go to a self-hosted Recap server instead.
//
// Windows:
//   library – the Recap library UI, served by the local engine
//   panel  – recorder settings + start; also hosts the MediaRecorder (kept alive while hidden)
//   bubble – circular camera window, always on top, captured with the screen on purpose
//   bar    – timer / pause / stop / discard, always on top, excluded from capture where the OS allows
const { app, BrowserWindow, Tray, Menu, ShareMenu, ipcMain, desktopCapturer, screen, globalShortcut, shell, clipboard, nativeImage, systemPreferences, safeStorage, dialog, Notification } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { engine, bin } = require("./engine");
const { execFile } = require("node:child_process");
const execFileP = require("node:util").promisify(execFile);

const HOTKEY = "CommandOrControl+Alt+R";
// How the shortcut is written on each platform: ⌥⌘R on macOS, Ctrl+Alt+R elsewhere.
const HOTKEY_LABEL = process.platform === "darwin" ? "⌥⌘R" : "Ctrl+Alt+R";
let hotkeyLabel = HOTKEY_LABEL; // blank when another app already owns the shortcut
// Startup milestones (ms since launch), reported by the self-test.
const T0 = Date.now();
const milestones = {};
const isWin = process.platform === "win32";
const isLinux = process.platform === "linux";

let panel = null;
let library = null;
let bubble = null;
let bar = null;
let tray = null;
let quitting = false;

// Recording session state lives here so every window sees the same thing.
const session = {
  phase: "idle", // idle | countdown | recording | paused | finishing | uploading | error
  countdown: 0,
  elapsed: 0,
  progress: 0,
  error: "",
  lastLink: "",
  lastFile: "",
  file: null, // { path, stream }
  opts: null,
  runId: 0,
  update: null, // { version, url } when a newer release exists
  quitAfterSave: false,
  localStorage: true, // the recorder's storage setting (panel reports it)
};

function broadcast() {
  const s = {
    phase: session.phase,
    countdown: session.countdown,
    elapsed: session.elapsed,
    progress: session.progress,
    error: session.error,
    lastLink: session.lastLink,
    lastFile: session.lastFile,
    hotkey: hotkeyLabel,
    platform: process.platform,
    engine: engine.status(),
    update: session.update,
    bubbleSize: session.opts?.bubbleSize ?? null,
    bubbleOn: !!bubble && !bubble.isDestroyed() && session.opts?.mode !== "cam",
  };
  for (const w of [panel, bar, bubble]) if (w && !w.isDestroyed()) w.webContents.send("state", s);
  tray?.setToolTip(s.phase === "recording" ? `Recap: recording ${fmt(s.elapsed)}` : "Recap");
}

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function setPhase(phase, extra = {}) {
  Object.assign(session, { phase }, extra);
  broadcast();
  if (session.quitAfterSave && (phase === "idle" || phase === "error")) {
    session.quitAfterSave = false;
    quitting = true;
    setTimeout(() => app.quit(), 300);
  }
}

const libraryDir = () => {
  const d = process.env.RECAP_SELFTEST
    ? path.join(process.env.RECAP_SELFTEST, "raw")
    : process.env.RECAP_DEV_HOME
      ? path.join(process.env.RECAP_DEV_HOME, "raw")
      : path.join(app.getPath("videos"), "Recap");
  fs.mkdirSync(d, { recursive: true });
  return d;
};

const webPrefs = { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: false, backgroundThrottling: false };

function createPanel() {
  panel = new BrowserWindow({
    show: false,
    width: 360,
    height: 640,
    resizable: false,
    maximizable: false,
    title: "Recap",
    backgroundColor: "#0a0a0a",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: webPrefs,
  });
  panel.loadFile(path.join(__dirname, "ui", "panel.html"), { query: process.env.RECAP_SNAPSHOT ? { snapshot: "1" } : {} });
  // Closing the panel hides it to the tray; recording keeps going.
  panel.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      panel.hide();
    }
  });
}

// The library is the engine's web UI. The one-time /__local URL hands the window its session cookie.
function openLibrary(pathname = "/") {
  if (engine.state !== "ready") return panel?.show();
  const url = `${engine.url}/__local?token=${engine.token}&next=${encodeURIComponent(pathname)}`;
  if (library && !library.isDestroyed()) {
    library.loadURL(url);
    library.show();
    library.focus();
    return;
  }
  library = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 760,
    minHeight: 520,
    title: "Recap",
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "library-preload.js"), contextIsolation: true, sandbox: true },
  });
  library.loadURL(url);
  library.webContents.once("did-finish-load", () => (milestones.libraryLoaded ??= Date.now() - T0));
  // Links that leave the engine (e.g. GitHub) open in the user's browser.
  library.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target) && !target.startsWith(engine.url)) shell.openExternal(target);
    return { action: "deny" };
  });
  library.webContents.on("will-navigate", (e, target) => {
    if (!target.startsWith(engine.url)) {
      e.preventDefault();
      if (/^https?:\/\//.test(target)) shell.openExternal(target);
    }
  });
  library.on("closed", () => (library = null));
}

const isLocal = (opts) => !opts?.server || !String(opts.server).trim();

function displayFor(id) {
  return screen.getAllDisplays().find((d) => String(d.id) === String(id)) ?? screen.getPrimaryDisplay();
}

const BUBBLE_SIZES = { s: 140, m: 200, l: 280 };

function createBubble(opts) {
  const d = displayFor(opts.displayId).workArea;
  const size = opts.mode === "cam" ? 320 : BUBBLE_SIZES[opts.bubbleSize] ?? 200;
  bubble = new BrowserWindow({
    width: size,
    height: size,
    x: d.x + 32,
    y: d.y + d.height - size - 32,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    webPreferences: webPrefs,
  });
  bubble.setAlwaysOnTop(true, "screen-saver");
  bubble.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bubble.loadFile(path.join(__dirname, "ui", "bubble.html"), { query: { cam: opts.cameraId || "" } });
}

/** Resize the camera bubble mid-recording, keeping its centre where the person dragged it. */
function setBubbleSize(key) {
  if (!BUBBLE_SIZES[key]) return;
  if (session.opts) session.opts.bubbleSize = key;
  if (!bubble || bubble.isDestroyed() || session.opts?.mode === "cam") return;
  const b = bubble.getBounds();
  const size = BUBBLE_SIZES[key];
  const area = screen.getDisplayMatching(b).workArea;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const x = Math.round(Math.min(Math.max(cx - size / 2, area.x), area.x + area.width - size));
  const y = Math.round(Math.min(Math.max(cy - size / 2, area.y), area.y + area.height - size));
  bubble.setResizable(true);
  bubble.setBounds({ x, y, width: size, height: size });
  bubble.setResizable(false);
  broadcast();
}

function createBar(opts) {
  const d = displayFor(opts.displayId).workArea;
  const w = 380;
  const h = 52;
  bar = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round(d.x + d.width / 2 - w / 2),
    y: d.y + d.height - h - 24,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: webPrefs,
  });
  bar.setAlwaysOnTop(true, "screen-saver");
  bar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Windows 10 2004+ and macOS honor this and leave the bar out of screen captures.
  // Linux has no equivalent, so the bar will be visible in the video there.
  bar.setContentProtection(true);
  bar.loadFile(path.join(__dirname, "ui", "bar.html"));
}

function closeOverlays() {
  for (const w of [bubble, bar]) if (w && !w.isDestroyed()) w.destroy();
  bubble = null;
  bar = null;
}

// ---- API token (safeStorage: DPAPI on Windows, libsecret on Linux; macOS uses a mock keychain, see below) ----

const tokenFile = () => path.join(app.getPath("userData"), "token.bin");

function readToken() {
  try {
    const buf = fs.readFileSync(tokenFile());
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString("utf8");
  } catch {
    return "";
  }
}

function writeToken(token) {
  const t = String(token || "").trim();
  if (!t) return fs.rmSync(tokenFile(), { force: true });
  fs.writeFileSync(tokenFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(t) : Buffer.from(t, "utf8"), { mode: 0o600 });
}

async function checkConnection(server) {
  if (!String(server ?? "").trim()) {
    if (engine.state !== "ready") return { ok: false, message: engine.error || "Local engine is starting…" };
    return { ok: true, message: "✓ this computer (local)" };
  }
  const token = readToken();
  if (!token) return { ok: false, message: "Paste an API token from Settings on your Recap server." };
  try {
    const res = await fetch(`${String(server).replace(/\/+$/, "")}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 200) return { ok: true, message: `✓ ${(await res.json()).email}` };
    if (res.status === 401) return { ok: false, message: "Token rejected. Create a new one under Settings on your server." };
    return { ok: false, message: `Server answered HTTP ${res.status}. Is the URL right?` };
  } catch (err) {
    return { ok: false, message: `Can't reach the server (${err.cause?.code ?? err.name}).` };
  }
}

// ---- recording flow ----------------------------------------------------------

async function start(opts) {
  if (!["idle", "error"].includes(session.phase)) return;
  if (isLocal(opts)) {
    if (engine.state !== "ready") {
      panel?.show();
      return setPhase("error", { error: engine.error || "The local engine is still starting. Try again in a moment." });
    }
  } else if (!readToken()) {
    panel?.show();
    return setPhase("error", { error: "Not connected. Open “server” and paste an API token from Settings on your Recap server." });
  }
  if (process.platform === "darwin") {
    const blocked = await macPermissionProblem(opts);
    if (blocked) {
      panel?.show();
      return setPhase("error", { error: blocked });
    }
  }
  const run = ++session.runId;
  session.opts = opts;
  session.elapsed = 0;
  session.error = "";

  let sourceId = null;
  if (opts.mode !== "cam") {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
    const src = sources.find((s) => String(s.display_id) === String(opts.displayId)) ?? sources[0];
    if (!src) return setPhase("error", { error: "No screen available to record." });
    sourceId = src.id;
  }

  const file = path.join(libraryDir(), `Recap ${new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19)}.webm`);
  const stream = fs.createWriteStream(file);
  // A failed write (disk full, folder removed) must stop the recording cleanly, not crash the app.
  stream.on("error", (err) => {
    if (session.file?.stream !== stream) return;
    session.runId++;
    session.file = null;
    panel?.webContents.send("control", "discard");
    closeOverlays();
    setPhase("error", { error: `Couldn't save the recording (${err.code ?? err.message}). Is the disk full? Free some space and try again.` });
    panel?.show();
  });
  session.file = { path: file, stream };

  panel.hide();
  if (opts.mode !== "screen") createBubble(opts);
  createBar(opts);

  for (let n = 3; n > 0; n--) {
    setPhase("countdown", { countdown: n });
    await new Promise((r) => setTimeout(r, 1000));
    if (run !== session.runId) return; // discarded during countdown
  }
  panel.webContents.send("begin", { ...opts, sourceId, systemAudio: opts.systemAudio && isWin });
}

function discard() {
  session.runId++;
  panel?.webContents.send("control", "discard");
  closeOverlays();
  if (session.file) {
    const { stream, path: p } = session.file;
    session.file = null;
    stream.end(() => fs.rm(p, { force: true }, () => {}));
  }
  setPhase("idle", { elapsed: 0 });
  panel?.show();
}

async function finish() {
  closeOverlays();
  const f = session.file;
  session.file = null;
  if (!f) return setPhase("idle");
  setPhase("finishing");
  await new Promise((r) => f.stream.end(r));
  session.lastFile = f.path;
  await upload(f.path);
}

async function upload(file, { quiet = false } = {}) {
  const local = isLocal(session.opts);
  const server = local ? engine.url : String(session.opts.server).trim().replace(/\/+$/, "");
  const token = local ? engine.token : readToken();
  setPhase("uploading", { progress: 0 });
  try {
    const size = fs.statSync(file).size;
    let sent = 0;
    let last = 0;
    const stream = fs.createReadStream(file);
    stream.on("data", (c) => {
      sent += c.length;
      const p = sent / size;
      if (p - last > 0.02 || p === 1) {
        last = p;
        setPhase("uploading", { progress: p });
      }
    });
    const headers = { "Content-Type": "video/webm", "Content-Length": String(size), Authorization: `Bearer ${token}` };
    const title = (session.opts?.title || "").trim();
    if (title) headers["x-title"] = encodeURIComponent(title);
    const res = await fetch(`${server}/api/videos`, { method: "POST", headers, body: Readable.toWeb(stream), duplex: "half" });
    if (res.status === 401) throw new Error("the server rejected the token; update it under “server”");
    if (res.status !== 201) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const { id } = await res.json();
    if (local) {
      // The engine keeps its own processed copy; the raw recording is no longer needed.
      await fs.promises.rm(file, { force: true });
      setPhase("idle", { lastLink: "", lastFile: "", progress: 0 });
      if (!quiet) openLibrary(`/v/${id}`);
      return;
    }
    const link = `${server}/v/${id}`;
    clipboard.writeText(link);
    shell.openExternal(link);
    setPhase("idle", { lastLink: link, progress: 0 });
  } catch (err) {
    if (quiet) return setPhase("idle", { progress: 0 }); // recovery: keep the file, try again next launch
    const where = local ? "the local library" : "the server";
    setPhase("error", { error: `Couldn't add the video to ${where} (${err.cause?.code ?? err.message}). The recording is saved in ${libraryDir()}. Use “retry upload”.` });
  }
  panel?.show();
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...(session.update ? [{ label: `Update available: ${session.update.version}…`, click: () => shell.openExternal(session.update.url) }, { type: "separator" }] : []),
      { label: "Open library", click: () => openLibrary() },
      { label: "New recording…", click: () => panel.show() },
      { label: hotkeyLabel ? `Start / stop recording (${hotkeyLabel})` : "Start / stop recording", click: toggle },
      { label: "Open recordings folder", click: () => shell.openPath(libraryDir()) },
      { type: "separator" },
      ...(process.platform === "linux"
        ? []
        : [{
            label: "Open at login",
            type: "checkbox",
            checked: app.getLoginItemSettings().openAtLogin,
            click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ["--hidden"] }),
          }]),
      { label: "About Recap", click: showAbout },
      { label: "Quit Recap", click: () => app.quit() },
    ]),
  );
}

function showAbout() {
  if (process.platform !== "win32") return app.showAboutPanel();
  dialog.showMessageBox({
    type: "none",
    icon: nativeImage.createFromPath(path.join(__dirname, "build", "icon.png")),
    title: "About Recap",
    message: `Recap ${app.getVersion()}`,
    detail: "Free and open source. Recordings and transcripts stay on this computer.\nUses FFmpeg and whisper.cpp.\n\n© 2026 Aditya · MIT License",
    buttons: ["OK", "Website"],
  }).then(({ response }) => response === 1 && shell.openExternal("https://recap.kronagent.dev"));
}

// macOS: without Screen Recording permission the capture is silently black, so check up front.
async function macPermissionProblem(opts) {
  const settings = (pane) => shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
  if (opts.mode !== "cam" && systemPreferences.getMediaAccessStatus("screen") !== "granted") {
    await desktopCapturer.getSources({ types: ["screen"] }).catch(() => {}); // shows the system prompt once
    if (systemPreferences.getMediaAccessStatus("screen") !== "granted") {
      settings("Privacy_ScreenCapture");
      return "Recap needs Screen Recording permission. Turn on Recap in System Settings → Privacy & Security → Screen & System Audio Recording, then quit and reopen Recap.";
    }
  }
  if (opts.mode !== "screen" && !(await systemPreferences.askForMediaAccess("camera"))) {
    settings("Privacy_Camera");
    return "Recap needs camera access. Turn on Recap in System Settings → Privacy & Security → Camera (or switch to screen-only).";
  }
  if (opts.micOn && !(await systemPreferences.askForMediaAccess("microphone"))) {
    settings("Privacy_Microphone");
    return "Recap needs microphone access. Turn on Recap in System Settings → Privacy & Security → Microphone (or turn the microphone off).";
  }
  return null;
}

// Raw recordings left behind by a crash, a quit mid-recording or a failed import are added to the
// local library on the next launch instead of being forgotten.
async function recoverLeftovers() {
  if (!session.localStorage || engine.state !== "ready" || session.phase !== "idle") return;
  let files = [];
  try {
    files = fs.readdirSync(libraryDir()).filter((f) => f.endsWith(".webm") && f !== path.basename(session.file?.path ?? ""));
  } catch {
    return;
  }
  for (const f of files) {
    const p = path.join(libraryDir(), f);
    if (fs.statSync(p).size < 4096) {
      fs.rmSync(p, { force: true }); // nothing usable was recorded
      continue;
    }
    session.opts = { server: "", title: `Recovered recording (${f.replace(/^Recap |\.webm$/g, "")})` };
    await upload(p, { quiet: true });
  }
}

// Tell people when a newer release exists (no auto-install: builds aren't signed yet).
async function checkForUpdate() {
  try {
    const res = await fetch("https://api.github.com/repos/Aditya-galaxy/recap/releases/latest", { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return;
    const { tag_name: tag, html_url: url } = await res.json();
    const newer = (a, b) => {
      const pa = a.replace(/^v/, "").split(".").map(Number);
      const pb = b.replace(/^v/, "").split(".").map(Number);
      for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
      return false;
    };
    if (tag && newer(tag, app.getVersion()) && session.update?.version !== tag.replace(/^v/, "")) {
      // Straight to this platform's installer; the release page if we don't know which one.
      const file = { darwin: "Recap-mac-arm64.dmg", win32: "Recap-windows-x64-setup.exe", linux: "Recap-linux-x86_64.AppImage" }[process.platform];
      session.update = {
        version: tag.replace(/^v/, ""),
        url: file ? `https://github.com/Aditya-galaxy/recap/releases/download/${tag}/${file}` : url,
      };
      broadcast();
      buildTrayMenu();
      if (Notification.isSupported()) {
        const n = new Notification({ title: `Recap ${session.update.version} is available`, body: "Click to download the new version." });
        n.on("click", () => shell.openExternal(session.update.url));
        n.show();
      }
    }
  } catch {}
}

function toggle() {
  if (["idle", "error"].includes(session.phase)) panel?.webContents.send("hotkey");
  else if (["recording", "paused"].includes(session.phase)) panel?.webContents.send("control", "stop");
  else if (session.phase === "countdown") discard();
}

// ---- IPC -------------------------------------------------------------------------

ipcMain.handle("displays", () =>
  screen.getAllDisplays().map((d, i) => ({
    id: String(d.id),
    name: `${d.label || `Display ${i + 1}`} · ${d.size.width}×${d.size.height}${d.id === screen.getPrimaryDisplay().id ? " (main)" : ""}`,
  })),
);
ipcMain.on("start", (_e, opts) => start(opts));
ipcMain.on("discard", () => discard());
ipcMain.on("retry-upload", () => session.lastFile && upload(session.lastFile));
ipcMain.on("bubble-size", (_e, key) => setBubbleSize(String(key)));
ipcMain.on("control", (_e, action) => {
  if (action === "discard") return discard();
  if (action === "bubble") {
    const order = ["s", "m", "l"];
    return setBubbleSize(order[(order.indexOf(session.opts?.bubbleSize ?? "m") + 1) % order.length]);
  }
  panel?.webContents.send("control", action);
});
ipcMain.on("recorder", (_e, ev) => {
  // Events from the MediaRecorder living in the panel.
  if (ev.type === "started") setPhase("recording");
  else if (ev.type === "paused") setPhase("paused");
  else if (ev.type === "resumed") setPhase("recording");
  else if (ev.type === "elapsed") {
    session.elapsed = ev.value;
    broadcast();
  } else if (ev.type === "stopped") finish();
  else if (ev.type === "notice" || ev.type === "camera-unavailable") {
    // Something degraded but the recording goes on: say so once, without interrupting.
    if (ev.type === "camera-unavailable" && bubble && !bubble.isDestroyed()) bubble.destroy();
    if (Notification.isSupported()) new Notification({ title: "Recap", body: String(ev.message ?? "") }).show();
  }
  else if (ev.type === "error") {
    closeOverlays();
    session.file?.stream.end();
    session.file = null;
    setPhase("error", { error: ev.message });
    panel?.show();
  }
});
ipcMain.on("chunk", (_e, buf) => session.file?.stream.write(Buffer.from(buf)));
ipcMain.on("open", (_e, what) => {
  if (what === "folder") shell.openPath(libraryDir());
  else if (typeof what === "string" && /^https?:\/\//.test(what)) shell.openExternal(what);
});
ipcMain.on("copy", (_e, text) => clipboard.writeText(String(text)));
ipcMain.on("state?", () => broadcast());
ipcMain.handle("token:has", () => !!readToken());
ipcMain.handle("token:set", (_e, token) => writeToken(token));
ipcMain.handle("connection:check", (_e, server) => checkConnection(server));
// ---- Sharing a video from the library: system share menu, copy, drag, show in folder ----------------
// The renderer names a video (id + version + title); the main process works out the file itself, so a
// page can never point these at an arbitrary path. Each share hands over "<title>.mp4" (a hard link into
// a temp folder, so even multi-GB videos cost no copy) rather than the library's internal "video.mp4".
const shareDir = path.join(app.getPath("temp"), "recap-share");
function shareFile(req, sender) {
  if (!library || sender !== library.webContents || !sender.getURL().startsWith(engine.url)) throw new Error("not allowed");
  const id = String(req?.id ?? "");
  if (!/^[a-z0-9]{10}$/.test(id)) throw new Error("bad video id");
  const version = req?.version === "clean" ? "clean" : "original";
  const src = path.join(engine.dataDir, "videos", id, version === "clean" ? "clean.mp4" : "video.mp4");
  if (!fs.existsSync(src)) throw new Error("That version of the video isn't ready.");
  // Same rules as the engine's safeFileName (src/lib/filename.ts): Windows-safe, no invisible text-direction marks
  // (which can disguise a file's extension), never a reserved device name like "nul.txt".
  let title =
    String(req?.title ?? "")
      .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c]/g, "")
      .replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\.+/, "")
      .slice(0, 120)
      .replace(/[. ]+$/, "") || "Recap video";
  if (/^(con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3]|conin\$|conout\$)$/i.test(title.split(".")[0].trim())) title = `Recap video ${title}`;
  const dir = path.join(shareDir, `${id}-${version}`);
  const out = path.join(dir, `${title}${version === "clean" ? " (cleaned)" : ""}.mp4`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.linkSync(src, out);
  } catch {
    fs.copyFileSync(src, out); // different volume, or a filesystem without hard links
  }
  return { out, thumb: path.join(engine.dataDir, "videos", id, "thumb.jpg") };
}

// Puts the file itself on the clipboard: paste into Slack, Teams, Mail, a chat or a folder. Electron's
// clipboard can't carry file references, so this uses the OS's own tool; the path never becomes script text.
async function copyFileToClipboard(file) {
  if (process.platform === "darwin") {
    // NSPasteboard writes the file URL immediately (AppleScript's `set the clipboard` hands over a lazy
    // promise that vanishes when osascript exits). Read it back through the same API to confirm, and
    // try again if another process got in between.
    const js = 'ObjC.import("AppKit"); function run(argv) { const pb = $.NSPasteboard.generalPasteboard; pb.clearContents; return pb.writeObjects($([$.NSURL.fileURLWithPath(argv[0])])); }';
    for (let attempt = 0; attempt < 3; attempt++) {
      await execFileP("osascript", ["-l", "JavaScript", "-e", js, file]);
      if (path.basename((await clipboardFile().catch(() => "")) ?? "") === path.basename(file)) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("Couldn't copy the video.");
  } else if (process.platform === "win32") {
    // -Command would splice extra arguments into the script text, so the path travels in the environment.
    await execFileP("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Set-Clipboard -LiteralPath $env:RECAP_SHARE_FILE"], {
      windowsHide: true,
      env: { ...process.env, RECAP_SHARE_FILE: file },
    });
  } else {
    throw new Error("Copying files isn't supported on Linux yet. Drag the video instead.");
  }
}

/** The file the clipboard currently points at, if any. */
async function clipboardFile() {
  if (process.platform === "darwin") {
    const js = 'ObjC.import("AppKit"); function run() { const urls = $.NSPasteboard.generalPasteboard.readObjectsForClassesOptions($([$.NSURL]), $()); return urls.isNil() || urls.count === 0 ? "" : ObjC.unwrap(urls.objectAtIndex(0).path); }';
    return (await execFileP("osascript", ["-l", "JavaScript", "-e", js])).stdout.trim();
  }
  if (process.platform === "win32") {
    return (await execFileP("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-Clipboard -Format FileDropList)[0].FullName"], { windowsHide: true })).stdout.trim();
  }
  return null;
}

ipcMain.handle("share", async (e, req) => {
  const { out } = shareFile(req, e.sender);
  switch (req?.action) {
    case "menu":
      if (process.platform !== "darwin") throw new Error("The share menu is macOS only.");
      new ShareMenu({ filePaths: [out] }).popup({ window: library });
      return "menu";
    case "copy":
      await copyFileToClipboard(out);
      return "copied";
    case "folder":
      shell.showItemInFolder(out);
      return "shown";
    default:
      throw new Error("unknown share action");
  }
});

// Drag the video out of the window into Slack, Teams, an email or a folder. Must answer synchronously.
ipcMain.on("share:drag", (e, req) => {
  try {
    const { out, thumb } = shareFile(req, e.sender);
    const icon = fs.existsSync(thumb) ? nativeImage.createFromPath(thumb).resize({ width: 96 }) : nativeImage.createFromPath(path.join(__dirname, "build", "icon.png")).resize({ width: 64 });
    e.sender.startDrag({ file: out, icon });
  } catch (err) {
    console.error("[share] drag failed:", err.message);
  }
});

ipcMain.on("library", (_e, pathname) => openLibrary(typeof pathname === "string" && pathname.startsWith("/") ? pathname : "/"));
ipcMain.on("model:retry", () => engine.ensureModel());
// The panel reports where recordings go, so recovery only imports into the local library.
ipcMain.on("storage", (_e, server) => {
  session.localStorage = !String(server ?? "").trim();
});
// From the library window's record button.
ipcMain.on("record-request", () => {
  panel?.show();
  panel?.focus();
});

// ---- app lifecycle --------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) app.quit();
// Windows: notifications and the taskbar need the same app ID the installer gave the Start menu shortcut,
// otherwise notices (camera busy, mic lost…) don't show.
if (process.platform === "win32") app.setAppUserModelId("dev.recap.desktop");
// Started by "Open at login": stay in the tray/menu bar instead of opening the library.
const startedHidden = process.argv.includes("--hidden") || (process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAtLogin);
app.on("second-instance", () => (engine.state === "ready" ? openLibrary() : panel?.show()));

// PipeWire screen capture on Wayland.
if (isLinux) app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer");
// macOS: keep Chromium (cookie encryption) and safeStorage out of the login keychain. Builds are only
// ad-hoc signed, so every update looks like a new app to the keychain and would ask for the user's
// password. The library's cookie is per-launch and local-only; the optional server token is protected
// by owner-only file permissions instead.
if (process.platform === "darwin") app.commandLine.appendSwitch("use-mock-keychain");
// Self-test on CI machines without a camera or microphone: Chromium's simulated devices (a moving test
// pattern and a beeping tone) let the real recording paths run end to end.
if (process.env.RECAP_SELFTEST && process.env.RECAP_SELFTEST_FAKE_MEDIA === "1") {
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
}

app.whenReady().then(() => {
  app.setAboutPanelOptions({
    applicationName: "Recap",
    applicationVersion: app.getVersion(),
    version: "",
    copyright: "© 2026 Aditya · MIT License",
    website: "https://recap.kronagent.dev",
    credits: "Free and open source. Recordings and transcripts stay on this computer. Uses FFmpeg and whisper.cpp.",
    iconPath: path.join(__dirname, "build", "icon.png"),
  });
  fs.rmSync(shareDir, { recursive: true, force: true }); // leftovers from a quit that skipped will-quit (e.g. a crash)
  createPanel();
  engine.on("status", broadcast);
  // After an engine crash it restarts on a new port; point an open library window at it, keeping the page.
  let engineOrigin = null;
  engine.on("status", () => {
    if (engine.state !== "ready") return;
    const origin = new URL(engine.url).origin;
    if (engineOrigin && origin !== engineOrigin && library && !library.isDestroyed()) {
      let page = "/";
      try {
        const u = new URL(library.webContents.getURL());
        if (u.origin === engineOrigin) page = u.pathname + u.search;
      } catch {}
      library.loadURL(`${engine.url}/__local?token=${engine.token}&next=${encodeURIComponent(page)}`);
    }
    engineOrigin = origin;
  });
  engine.ensureModel();
  engine.start().then(() => {
    milestones.engineReady = Date.now() - T0;
    if (engine.state === "ready" && !startedHidden && !process.env.RECAP_SNAPSHOT && !process.env.RECAP_SELFTEST) openLibrary();
    else if (engine.state !== "ready") panel.show();
    if (!process.env.RECAP_SELFTEST) setTimeout(recoverLeftovers, 2000);
  });
  // Recap lives in the menu bar for days at a time, so look again every 6 hours, not just at launch.
  if (!process.env.RECAP_SELFTEST && !process.env.RECAP_SNAPSHOT) {
    setTimeout(checkForUpdate, 5000);
    setInterval(checkForUpdate, 6 * 60 * 60_000);
  }

  const trayIcon = nativeImage.createFromPath(path.join(__dirname, "build", process.platform === "darwin" ? "trayTemplate.png" : "tray.png"));
  tray = new Tray(trayIcon);
  tray.setToolTip("Recap");
  // Another app (a screen recorder, a video-call app) may already own the shortcut: then don't show one that does nothing.
  if (!globalShortcut.register(HOTKEY, toggle)) {
    console.warn(`could not register ${HOTKEY}`);
    hotkeyLabel = "";
  }
  buildTrayMenu();
  tray.on("click", () => (panel.isVisible() ? panel.hide() : panel.show()));

  // Dev aid: RECAP_SNAPSHOT=dir renders the panel and the overlays to PNGs, then quits.
  if (process.env.RECAP_SNAPSHOT) snapshot(process.env.RECAP_SNAPSHOT);
  // Dev aid: RECAP_SELFTEST=dir RECAP_SELFTEST_FILE=video pushes a file through the local pipeline.
  if (process.env.RECAP_SELFTEST) selftest(process.env.RECAP_SELFTEST, process.env.RECAP_SELFTEST_FILE);
});

async function selftest(dir, sample) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const report = { platform: `${process.platform}-${process.arch}`, version: app.getVersion(), steps: [] };
  const step = (name, ok, extra = {}) => report.steps.push({ name, ok: !!ok, ...extra });
  const shot = async (name) => {
    try {
      fs.writeFileSync(path.join(dir, name), (await library.webContents.capturePage()).toPNG());
    } catch {}
  };
  try {
    for (let i = 0; i < 300 && engine.state !== "ready"; i++) await wait(100);
    step("engine ready", engine.state === "ready", { error: engine.error || undefined });
    // Like a normal launch: open the library as soon as the engine is up, to time a cold start.
    openLibrary("/");
    for (let i = 0; i < 200 && milestones.libraryLoaded === undefined; i++) await wait(50);
    // Typically ~1.8 s. The very first launch of a fresh install can spike (7-10 s seen on Windows CI while
    // Defender scans the new program), so the bar is 15 s: loose enough for that, tight enough to catch a regression.
    step("cold start: library loaded < 15 s", (milestones.libraryLoaded ?? Infinity) < 15_000, { ms: milestones.libraryLoaded });
    // Wait until the page has rendered past its loading placeholder (slow CI machines need a while).
    const pageText = async (ready = /\S/) => {
      let t = "";
      for (let i = 0; i < 120; i++) {
        t = await library.webContents.executeJavaScript("document.body.innerText").catch(() => "");
        if (t && !/loading…/.test(t) && ready.test(t)) return t;
        await wait(250);
      }
      return t;
    };
    const firstRun = await pageText(/Welcome to Recap|Recordings/);
    step("first run: welcome screen, no terminal text", /Welcome to Recap/.test(firstRun) && !/\$ recap/.test(firstRun), { text: firstRun.slice(0, 120) });
    for (let i = 0; i < 1200 && engine.model.state !== "ready"; i++) await wait(100);
    step("model ready", engine.model.state === "ready", { error: engine.model.error || undefined });
    const auth = { Authorization: `Bearer ${engine.token}` };
    const api = (p, init = {}) => fetch(`${engine.url}${p}`, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });

    // Security boundaries.
    step("rejects requests without the launch secret", (await fetch(`${engine.url}/api/videos`)).status === 401);
    step("rejects a wrong secret", (await fetch(`${engine.url}/api/videos`, { headers: { Authorization: "Bearer x" } })).status === 401);
    step("no account endpoints in local mode", (await api("/api/auth/signup", { method: "POST", body: "{}" })).status === 404);
    const redirect = await fetch(`${engine.url}/__local?token=${engine.token}&next=${encodeURIComponent("/\\evil.example")}`, { redirect: "manual" });
    step("bootstrap can't redirect off-site", !(redirect.headers.get("location") ?? "").includes("evil"));
    step("health", (await (await api("/api/health")).json()).ok === true);

    // The real recording path: raw file → upload() → local library → processing.
    const raw = path.join(libraryDir(), "selftest.webm");
    fs.copyFileSync(sample, raw);
    session.opts = { server: "", title: "Self test ✓ ünïcode" };
    await upload(raw);
    step("upload into local library", session.phase === "idle", { error: session.error || undefined });
    step("raw recording cleaned up", !fs.existsSync(raw));
    const list = await (await api("/api/videos")).json();
    const video = list.find((v) => v.title === "Self test ✓ ünïcode");
    step("title preserved (unicode)", !!video);
    const until = async (pred, secs) => {
      let d;
      for (let i = 0; i < secs; i++) {
        d = await (await api(`/api/videos/${video.id}`)).json();
        if (pred(d.meta)) break;
        await wait(1000);
      }
      return d;
    };
    const detail = await until((m) => m.status === "ready" || m.status === "error", 300);
    // Regression guard: v0.3.0/0.3.1 silently truncated uploads over 10 MB. The stored video must be as
    // long as the recording that went in.
    const srcDuration = await new Promise((resolve) => {
      const p = require("node:child_process").spawn(bin("ffmpeg"), ["-hide_banner", "-i", sample]);
      let err = "";
      p.stderr.on("data", (d) => (err += d));
      p.on("close", () => {
        const m = err.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
        resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0);
      });
    });
    step("upload not truncated (duration matches source)", srcDuration > 0 && Math.abs((detail.meta.duration ?? 0) - srcDuration) < 1, {
      source: srcDuration,
      stored: detail.meta.duration,
      bytes: fs.statSync(sample).size,
    });
    step("processed + transcribed", detail.meta.status === "ready" && detail.transcript?.words?.length > 0, { error: detail.meta.error, words: detail.transcript?.words?.length });
    report.transcript = detail.transcript?.words?.map((w) => w.text).join(" ");
    step("thumbnail", (await api(`/api/videos/${video.id}/thumb`)).headers.get("content-type") === "image/jpeg");
    const range = await api(`/api/videos/${video.id}/media`, { headers: { Range: "bytes=0-1023" } });
    step("seekable video (HTTP range)", range.status === 206);
    step("captions", (await (await api(`/api/videos/${video.id}/captions`)).text()).startsWith("WEBVTT"));

    // Clean-up render (second ffmpeg pass with a filter-graph file; exercises paths with spaces on Windows).
    const clean = await api(`/api/videos/${video.id}/clean`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fillers: true, silences: true, minSilence: 0.4 }) });
    if (clean.status === 202) {
      const after = await until((m) => m.clean.status === "ready" || m.clean.status === "error", 300);
      step("clean cut rendered", after.meta.clean.status === "ready", { error: after.meta.clean.error });
      step("clean cut playable", (await api(`/api/videos/${video.id}/media?v=clean`, { headers: { Range: "bytes=0-1023" } })).status === 206);
    } else {
      // With a speech sample (CI) there must be something to cut; a tone-only sample may legitimately have nothing.
      const strict = process.env.RECAP_SELFTEST_EXPECT_CUTS === "1";
      step("clean cut rendered", !strict && clean.status === 400, { note: "nothing to cut in this sample", status: clean.status });
    }
    const dl = await api(`/api/videos/${video.id}/media?download`, { method: "HEAD" });
    step("export named after the title", /Self%20test/.test(dl.headers.get("content-disposition") ?? ""));

    // Step-by-step guide: steps from the narration with a screenshot each, exported as one HTML file.
    await api(`/api/videos/${video.id}/guide`, { method: "POST" });
    let guide = null;
    for (let i = 0; i < 120 && guide?.status !== "ready" && guide?.status !== "error"; i++) {
      await wait(1000);
      guide = (await (await api(`/api/videos/${video.id}/guide`)).json()).guide;
    }
    const html = guide?.status === "ready" ? await (await api(`/api/videos/${video.id}/guide?format=html`)).text() : "";
    step("guide: steps with screenshots, exported", guide?.status === "ready" && guide.steps.length > 0 && guide.steps.every((s) => s.text) && (html.match(/data:image\/jpeg;base64/g) ?? []).length === guide.steps.length, {
      status: guide?.status, error: guide?.error, steps: guide?.steps?.length,
    });

    // Bug report: steps to reproduce with screenshots, the environment, and an export that carries the screenshots.
    await api(`/api/videos/${video.id}/bug`, { method: "POST" });
    let bugReport = null;
    for (let i = 0; i < 120 && bugReport?.status !== "ready" && bugReport?.status !== "error"; i++) {
      await wait(1000);
      bugReport = (await (await api(`/api/videos/${video.id}/bug`)).json()).report;
    }
    const reportHtml = bugReport?.status === "ready" ? await (await api(`/api/videos/${video.id}/bug?format=html`)).text() : "";
    const reportMd = bugReport?.status === "ready" ? await (await api(`/api/videos/${video.id}/bug?format=md`)).text() : "";
    const images = bugReport ? bugReport.steps.length + (bugReport.actualImage ? 1 : 0) : -1;
    step("bug report: steps, environment, exports", bugReport?.status === "ready" && bugReport.steps.length > 0 && bugReport.environment.length > 0 && (reportHtml.match(/data:image\/jpeg;base64/g) ?? []).length === images && /Steps to reproduce/.test(reportMd), {
      status: bugReport?.status, error: bugReport?.error, steps: bugReport?.steps?.length, title: bugReport?.title,
    });

    // Optional on-device AI polish (CI sets RECAP_SELFTEST_POLISH=1): the real download (with its checksum), then a polish.
    if (process.env.RECAP_SELFTEST_POLISH === "1" && guide?.status === "ready") {
      const t0 = Date.now();
      let ai = await (await api("/api/ai", { method: "POST" })).json();
      for (let i = 0; i < 900 && ai.model === "downloading"; i++) {
        await wait(1000);
        ai = await (await api("/api/ai")).json();
      }
      step("AI: model downloaded and verified", ai.available && ai.model === "ready", { model: ai.model, error: ai.error, secs: Math.round((Date.now() - t0) / 1000) });
      if (ai.model === "ready") {
        const t1 = Date.now();
        await api(`/api/videos/${video.id}/guide/polish`, { method: "POST" });
        let pg = null;
        for (let i = 0; i < 600 && pg?.status !== "ready"; i++) {
          await wait(1000);
          pg = (await (await api(`/api/videos/${video.id}/guide`)).json()).guide;
        }
        step("AI: guide polished, every step kept", pg?.status === "ready" && pg.polished === true && pg.steps.length === guide.steps.length && pg.steps.every((s) => s.text && s.spoken), {
          error: pg?.error, secs: Math.round((Date.now() - t1) / 1000), first: pg?.steps?.[0]?.text?.slice(0, 80),
        });
      }
    }

    await wait(500);
    openLibrary(`/v/${video.id}`);
    // "launch" rather than an exact phrase: Linux CI's synthetic voice (espeak) comes out as "quick up, date".
    const watchText = await pageText(/launch/i);
    await shot("library-video.png");
    // The video page as a person sees it: transcript words, clean-up, and the share button (desktop bridge).
    const share = await library.webContents.executeJavaScript(`[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "share")`).catch(() => false);
    step("video page: transcript, clean up and share", /launch/i.test(watchText) && /clean up/i.test(watchText) && share, { share, text: watchText.slice(0, 160) });
    openLibrary("/?q=Self%20test");
    await wait(500);
    const found = await pageText(/Recordings[\s\S]*Self test/);
    openLibrary("/?q=zzzz-no-such-video");
    await wait(500);
    const none = await pageText(/No videos match/);
    step("library search", /Recordings[\s\S]*Self test/.test(found) && /No videos match/.test(none));
    openLibrary("/");
    await wait(2500);
    await shot("library-home.png");

    // Sharing: a hard-linked copy named after the title, and (macOS/Windows) the file on the clipboard.
    try {
      const { out } = shareFile({ id: video.id, version: "original", title: "Self: test/share?" }, library.webContents);
      step("share: copy named after the title", path.basename(out) === "Self test share.mp4" && fs.statSync(out).size > 0, { file: path.basename(out) });
      if (process.platform !== "linux") {
        await copyFileToClipboard(out);
        const got = await clipboardFile();
        step("share: video file on the clipboard", !!got && path.basename(got) === path.basename(out), { got });
      }
    } catch (err) {
      step("share", false, { error: String(err?.message ?? err) });
    }

    // Background noise must not turn into words: the voice-activity model ships with the app on every
    // platform and whisper skips non-speech audio.
    try {
      const vadModel = path.join(path.dirname(bin("ffmpeg")), "ggml-silero-v5.1.2.bin");
      step("noise filter bundled", fs.existsSync(vadModel) && fs.statSync(vadModel).size > 500_000, { file: path.basename(vadModel) });
      const noise = path.join(dir, "noise.mkv");
      await execFileP(bin("ffmpeg"), ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=gray:s=640x360:r=30:d=12", "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.15:d=12", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", noise]);
      const res = await api("/api/videos", { method: "POST", headers: { "x-title": "Noise only" }, body: fs.readFileSync(noise) });
      const { id } = await res.json();
      let detail = null;
      for (let i = 0; i < 600; i++) {
        detail = await (await api(`/api/videos/${id}`)).json();
        if (detail.meta.status === "ready" || detail.meta.status === "error") break;
        await wait(200);
      }
      const words = detail?.transcript?.words ?? [];
      step("noise isn't transcribed as words", detail?.meta.status === "ready" && words.length === 0, { words: words.map((w) => w.text).join(" ").slice(0, 80) || undefined });
    } catch (err) {
      step("noise filter", false, { error: String(err?.message ?? err) });
    }

    // Crash recovery: an orphaned raw recording is imported on the next start.
    const orphan = path.join(libraryDir(), "Recap 2026-01-01-00-00-00.webm");
    fs.copyFileSync(sample, orphan);
    session.localStorage = true;
    await recoverLeftovers();
    const recovered = (await (await api("/api/videos")).json()).find((v) => v.title.startsWith("Recovered recording"));
    step("orphaned recording recovered", !!recovered && !fs.existsSync(orphan));

    // A real recording through the recorder itself (screen capture → MediaRecorder → import → processing),
    // not a sample file. CI turns this on for Windows and Linux; macOS runners can't grant screen access.
    if (process.env.RECAP_SELFTEST_CAPTURE === "1") {
      try {
        const before = new Set((await (await api("/api/videos")).json()).map((v) => v.id));
        openLibrary("/"); // something on screen to record
        await wait(1500);
        start({ mode: "screen", micOn: false, systemAudio: false, server: "", displayId: screen.getPrimaryDisplay().id, title: "Capture test" });
        for (let i = 0; i < 200 && session.phase !== "recording" && session.phase !== "error"; i++) await wait(100);
        step("capture: recording started", session.phase === "recording", { phase: session.phase, error: session.error || undefined });
        await wait(5000);
        panel.webContents.send("control", "stop");
        let captured = null;
        for (let i = 0; i < 1200 && !captured; i++) {
          await wait(100);
          const list = await (await api("/api/videos")).json();
          captured = list.find((v) => !before.has(v.id) && (v.status === "ready" || v.status === "error")) ?? null;
        }
        step("capture: video saved and processed", captured?.status === "ready", { status: captured?.status, error: captured?.error });
        if (captured) {
          const meta = (await (await api(`/api/videos/${captured.id}`)).json()).meta;
          step("capture: real screen resolution and length", meta.width >= 640 && meta.height >= 360 && meta.duration >= 3, {
            width: meta.width, height: meta.height, duration: meta.duration,
          });
          // The library window was on screen, so the frames must have content (not a black or empty capture).
          const video = path.join(engine.dataDir, "videos", captured.id, "video.mp4");
          const { stderr } = await execFileP(bin("ffmpeg"), ["-hide_banner", "-ss", "2", "-i", video, "-frames:v", "1", "-vf", "signalstats,metadata=print", "-f", "null", "-"]).catch((e) => e);
          const range = Number(/YHIGH=(\d+)/.exec(stderr ?? "")?.[1] ?? 0) - Number(/YLOW=(\d+)/.exec(stderr ?? "")?.[1] ?? 0);
          step("capture: frames have content", range > 40, { lumaRange: range });
        }
      } catch (err) {
        step("capture", false, { error: String(err?.message ?? err) });
      }

      // Camera, microphone, the camera bubble, pause/resume and discard, with simulated devices on CI.
      if (process.env.RECAP_SELFTEST_FAKE_MEDIA === "1") {
        const waitPhase = async (phases, ms = 20_000) => {
          for (let i = 0; i < ms / 100 && !phases.includes(session.phase); i++) await wait(100);
          return session.phase;
        };
        const known = async () => new Set((await (await api("/api/videos")).json()).map((v) => v.id));
        const newVideo = async (before) => {
          for (let i = 0; i < 1200; i++) {
            const v = (await (await api("/api/videos")).json()).find((x) => !before.has(x.id) && (x.status === "ready" || x.status === "error"));
            if (v) return v;
            await wait(100);
          }
          return null;
        };
        const hasAudio = async (id) => /Audio:/.test(((await execFileP(bin("ffmpeg"), ["-hide_banner", "-i", path.join(engine.dataDir, "videos", id, "video.mp4")]).catch((e) => e)).stderr ?? ""));
        const base = { server: "", systemAudio: false, displayId: screen.getPrimaryDisplay().id, cameraId: "", micId: "" };

        try {
          // Camera only, with the microphone.
          let before = await known();
          start({ ...base, mode: "cam", micOn: true, title: "Camera test" });
          step("camera: recording started", (await waitPhase(["recording", "error"])) === "recording", { error: session.error || undefined });
          await wait(4000);
          panel.webContents.send("control", "stop");
          let v = await newVideo(before);
          step("camera: video with sound", v?.status === "ready" && v.width > 0 && v.duration >= 3 && (await hasAudio(v.id)), { status: v?.status, width: v?.width, duration: v?.duration });
          await waitPhase(["idle"]);

          // Screen + camera bubble, resized mid-recording.
          before = await known();
          start({ ...base, mode: "screenCam", micOn: true, bubbleSize: "m", title: "Bubble test" });
          await waitPhase(["recording", "error"]);
          const m = bubble && !bubble.isDestroyed() ? bubble.getBounds().width : 0;
          setBubbleSize("l");
          await wait(300);
          const l = bubble && !bubble.isDestroyed() ? bubble.getBounds().width : 0;
          step("bubble: shown and resizes live", m === 200 && l === 280, { medium: m, large: l });
          await wait(3000);
          panel.webContents.send("control", "stop");
          v = await newVideo(before);
          step("screen + camera: video with sound", v?.status === "ready" && v.duration >= 2.5 && (await hasAudio(v.id)), { status: v?.status, duration: v?.duration });
          await waitPhase(["idle"]);

          // Pause and resume: the paused stretch isn't in the video.
          before = await known();
          start({ ...base, mode: "screen", micOn: true, title: "Pause test" });
          await waitPhase(["recording", "error"]);
          await wait(2000);
          panel.webContents.send("control", "pause");
          const paused = await waitPhase(["paused"], 5000);
          await wait(4000);
          panel.webContents.send("control", "resume");
          await waitPhase(["recording"], 5000);
          await wait(2000);
          panel.webContents.send("control", "stop");
          v = await newVideo(before);
          step("pause / resume leaves the paused part out", paused === "paused" && v?.status === "ready" && v.duration >= 3 && v.duration < 6, { duration: v?.duration });
          await waitPhase(["idle"]);

          // Discard: nothing saved, no leftover raw file.
          before = await known();
          const raws = new Set(fs.readdirSync(libraryDir()));
          start({ ...base, mode: "screen", micOn: true, title: "Discard test" });
          await waitPhase(["recording", "error"]);
          await wait(2000);
          discard();
          await waitPhase(["idle"], 5000);
          await wait(3000);
          const after = await known();
          const leftovers = fs.readdirSync(libraryDir()).filter((f) => !raws.has(f) && f.endsWith(".webm"));
          step("discard saves nothing", after.size === before.size && leftovers.length === 0, { leftovers });
        } catch (err) {
          step("media", false, { error: String(err?.message ?? err) });
        }
      }
    }

    // Deleting removes it everywhere.
    for (const v of await (await api("/api/videos")).json()) await api(`/api/videos/${v.id}`, { method: "DELETE" });
    step("delete", (await (await api("/api/videos")).json()).length === 0);
  } catch (err) {
    step("exception", false, { error: String(err?.stack ?? err) });
  }
  // Performance: cold start and memory (all Recap processes: main, windows, GPU, engine).
  const mem = app.getAppMetrics().reduce((a, m) => a + (m.memory?.workingSetSize ?? 0), 0);
  report.metrics = {
    engineReadyMs: milestones.engineReady,
    libraryLoadedMs: milestones.libraryLoaded,
    memoryMB: Math.round(mem / 1024),
    memoryByProcess: app.getAppMetrics().map((m) => `${m.type}${m.serviceName ? `:${m.serviceName}` : ""} ${Math.round((m.memory?.workingSetSize ?? 0) / 1024)}MB`),
  };
  step("cold start: engine ready < 10 s", (milestones.engineReady ?? Infinity) < 10_000, { ms: milestones.engineReady });
  report.passed = report.steps.every((s) => s.ok);
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
  quitting = true;
  app.quit();
}

async function snapshot(dir) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (w, name) => fs.writeFileSync(path.join(dir, name), (await w.webContents.capturePage()).toPNG());
  await wait(1500);
  await shot(panel, "panel.png");
  const opts = { displayId: screen.getPrimaryDisplay().id, mode: "screen", bubbleSize: "m" };
  createBar(opts);
  setPhase("countdown", { countdown: 3 });
  await wait(800);
  await shot(bar, "bar-countdown.png");
  setPhase("recording", { elapsed: 83 });
  await wait(300);
  await shot(bar, "bar-recording.png");
  setPhase("error", { error: "Upload failed (ECONNREFUSED). The video is saved in ~/Videos/Recap. Use “retry upload”.", lastFile: "x" });
  closeOverlays();
  panel.show();
  await wait(500);
  await shot(panel, "panel-error.png");
  quitting = true;
  app.quit();
}

// Quitting mid-recording or mid-save would lose (or orphan) the video: ask first.
app.on("before-quit", (e) => {
  const busy = ["countdown", "recording", "paused", "finishing", "uploading"].includes(session.phase);
  if (busy && !session.quitAfterSave && !process.env.RECAP_SELFTEST) {
    e.preventDefault();
    const choice = dialog.showMessageBoxSync({
      type: "warning",
      buttons: ["Stop, save and quit", "Keep recording", "Quit without saving"],
      defaultId: 0,
      cancelId: 1,
      message: session.phase === "finishing" || session.phase === "uploading" ? "Recap is still saving your recording." : "Recap is recording.",
      detail: "Quitting now would lose this recording.",
    });
    if (choice === 1) return;
    if (choice === 0) {
      session.quitAfterSave = true;
      if (["recording", "paused"].includes(session.phase)) panel?.webContents.send("control", "stop");
      else if (session.phase === "countdown") discard();
      return; // quits when the save finishes (see setPhase)
    }
  }
  quitting = true;
  engine.stop();
});

app.on("activate", () => (engine.state === "ready" ? openLibrary() : panel?.show()));
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  fs.rmSync(shareDir, { recursive: true, force: true }); // hard links: the library copies are untouched
});
app.on("window-all-closed", (e) => e.preventDefault());
