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
    hotkey: HOTKEY.replace("CommandOrControl", process.platform === "darwin" ? "⌘" : "Ctrl"),
    platform: process.platform,
    engine: engine.status(),
    update: session.update,
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

function createBubble(opts) {
  const d = displayFor(opts.displayId).workArea;
  const size = opts.mode === "cam" ? 320 : { s: 140, m: 200, l: 280 }[opts.bubbleSize] ?? 200;
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

function createBar(opts) {
  const d = displayFor(opts.displayId).workArea;
  const w = 340;
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

// ---- API token (encrypted with the OS keychain / DPAPI / libsecret via safeStorage) ------

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
      { label: `Start / stop recording (${HOTKEY.replace("CommandOrControl", process.platform === "darwin" ? "⌘" : "Ctrl")})`, click: toggle },
      { label: "Open recordings folder", click: () => shell.openPath(libraryDir()) },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
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
    if (tag && newer(tag, app.getVersion())) {
      session.update = { version: tag.replace(/^v/, ""), url: "https://recap.kronagent.dev" };
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
ipcMain.on("control", (_e, action) => {
  if (action === "discard") return discard();
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
  const title =
    String(req?.title ?? "")
      .replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\.+|[. ]+$/g, "")
      .slice(0, 120) || "Recap video";
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
    // promise that vanishes when osascript exits).
    const js = 'ObjC.import("AppKit"); function run(argv) { const pb = $.NSPasteboard.generalPasteboard; pb.clearContents; return pb.writeObjects($([$.NSURL.fileURLWithPath(argv[0])])); }';
    const { stdout } = await execFileP("osascript", ["-l", "JavaScript", "-e", js, file]);
    if (stdout.trim() !== "true") throw new Error("Couldn't copy the video.");
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

/** What the clipboard's file reference points at (self-test only). */
async function clipboardFile() {
  if (process.platform === "darwin") return (await execFileP("osascript", ["-e", "POSIX path of (the clipboard as «class furl»)"])).stdout.trim();
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
app.on("second-instance", () => (engine.state === "ready" ? openLibrary() : panel?.show()));

// PipeWire screen capture on Wayland.
if (isLinux) app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer");

app.whenReady().then(() => {
  fs.rmSync(shareDir, { recursive: true, force: true }); // leftovers from a quit that skipped will-quit (e.g. a crash)
  createPanel();
  engine.on("status", broadcast);
  engine.ensureModel();
  engine.start().then(() => {
    milestones.engineReady = Date.now() - T0;
    if (engine.state === "ready" && !process.env.RECAP_SNAPSHOT && !process.env.RECAP_SELFTEST) openLibrary();
    else if (engine.state !== "ready") panel.show();
    if (!process.env.RECAP_SELFTEST) setTimeout(recoverLeftovers, 2000);
  });
  if (!process.env.RECAP_SELFTEST && !process.env.RECAP_SNAPSHOT) setTimeout(checkForUpdate, 5000);

  const trayIcon = nativeImage.createFromPath(path.join(__dirname, "build", process.platform === "darwin" ? "trayTemplate.png" : "tray.png"));
  tray = new Tray(trayIcon);
  tray.setToolTip("Recap");
  buildTrayMenu();
  tray.on("click", () => (panel.isVisible() ? panel.hide() : panel.show()));

  if (!globalShortcut.register(HOTKEY, toggle)) console.warn(`could not register ${HOTKEY}`);

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
    step("cold start: library loaded < 10 s", (milestones.libraryLoaded ?? Infinity) < 10_000, { ms: milestones.libraryLoaded });
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

    await wait(500);
    openLibrary(`/v/${video.id}`);
    await wait(3000);
    await shot("library-video.png");
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

    // Crash recovery: an orphaned raw recording is imported on the next start.
    const orphan = path.join(libraryDir(), "Recap 2026-01-01-00-00-00.webm");
    fs.copyFileSync(sample, orphan);
    session.localStorage = true;
    await recoverLeftovers();
    const recovered = (await (await api("/api/videos")).json()).find((v) => v.title.startsWith("Recovered recording"));
    step("orphaned recording recovered", !!recovered && !fs.existsSync(orphan));

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
