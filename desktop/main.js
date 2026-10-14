// Recap desktop (Windows / Linux; also runs on macOS for development).
//
// Windows:
//   panel  – settings + start; also hosts the MediaRecorder (kept alive while hidden)
//   bubble – circular camera window, always on top, captured with the screen on purpose
//   bar    – timer / pause / stop / discard, always on top, excluded from capture where the OS allows
const { app, BrowserWindow, Tray, Menu, ipcMain, desktopCapturer, screen, globalShortcut, shell, clipboard, nativeImage, systemPreferences, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const HOTKEY = "CommandOrControl+Alt+R";
const isWin = process.platform === "win32";
const isLinux = process.platform === "linux";

let panel = null;
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
  };
  for (const w of [panel, bar, bubble]) if (w && !w.isDestroyed()) w.webContents.send("state", s);
  tray?.setToolTip(s.phase === "recording" ? `Recap: recording ${fmt(s.elapsed)}` : "Recap");
}

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function setPhase(phase, extra = {}) {
  Object.assign(session, { phase }, extra);
  broadcast();
}

const libraryDir = () => {
  const d = path.join(app.getPath("videos"), "Recap");
  fs.mkdirSync(d, { recursive: true });
  return d;
};

const webPrefs = { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: false, backgroundThrottling: false };

function createPanel() {
  panel = new BrowserWindow({
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
  if (!readToken()) {
    panel?.show();
    return setPhase("error", { error: "Not connected. Open “server” and paste an API token from Settings on your Recap server." });
  }
  if (process.platform === "darwin" && opts.mode !== "cam" && systemPreferences.getMediaAccessStatus("screen") !== "granted") {
    // Triggers the macOS prompt; on Windows/Linux there is no such gate.
    await desktopCapturer.getSources({ types: ["screen"] }).catch(() => {});
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
  session.file = { path: file, stream: fs.createWriteStream(file) };

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

async function upload(file) {
  const server = (session.opts?.server || "http://localhost:3217").replace(/\/+$/, "");
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
    const headers = { "Content-Type": "video/webm", "Content-Length": String(size), Authorization: `Bearer ${readToken()}` };
    const title = (session.opts?.title || "").trim();
    if (title) headers["x-title"] = encodeURIComponent(title);
    const res = await fetch(`${server}/api/videos`, { method: "POST", headers, body: Readable.toWeb(stream), duplex: "half" });
    if (res.status === 401) throw new Error("the server rejected the token; update it under “server”");
    if (res.status !== 201) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const { id } = await res.json();
    const link = `${server}/v/${id}`;
    clipboard.writeText(link);
    shell.openExternal(link);
    setPhase("idle", { lastLink: link, progress: 0 });
  } catch (err) {
    setPhase("error", { error: `Upload failed (${err.cause?.code ?? err.message}). The video is saved in ${libraryDir()}. Use “retry upload”.` });
  }
  panel?.show();
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

// ---- app lifecycle --------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => panel?.show());

// PipeWire screen capture on Wayland.
if (isLinux) app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer");

app.whenReady().then(() => {
  createPanel();

  const trayIcon = nativeImage.createFromPath(path.join(__dirname, "build", process.platform === "darwin" ? "trayTemplate.png" : "tray.png"));
  tray = new Tray(trayIcon);
  tray.setToolTip("Recap");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Recap", click: () => panel.show() },
      { label: `Start / stop recording (${HOTKEY.replace("CommandOrControl", "Ctrl")})`, click: toggle },
      { label: "Open recordings folder", click: () => shell.openPath(libraryDir()) },
      { type: "separator" },
      { label: "Quit", click: () => { quitting = true; app.quit(); } },
    ]),
  );
  tray.on("click", () => (panel.isVisible() ? panel.hide() : panel.show()));

  if (!globalShortcut.register(HOTKEY, toggle)) console.warn(`could not register ${HOTKEY}`);

  // Dev aid: RECAP_SNAPSHOT=dir renders the panel and the overlays to PNGs, then quits.
  if (process.env.RECAP_SNAPSHOT) snapshot(process.env.RECAP_SNAPSHOT);
});

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

app.on("before-quit", () => (quitting = true));
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", (e) => e.preventDefault());
