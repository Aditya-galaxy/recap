// Recap desktop: local-first. Recording, transcription and clean-up all run on this computer via the
// bundled engine (engine.js). Optionally, recordings can go to a self-hosted Recap server instead.
//
// Windows:
//   library – the Recap library UI, served by the local engine
//   panel  – recorder settings + start; also hosts the MediaRecorder (kept alive while hidden)
//   bubble – circular camera window, always on top, captured with the screen on purpose
//   bar    – timer / pause / stop / discard, always on top, excluded from capture where the OS allows
const { app, BrowserWindow, Tray, Menu, ipcMain, desktopCapturer, screen, globalShortcut, shell, clipboard, nativeImage, systemPreferences, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { engine } = require("./engine");

const HOTKEY = "CommandOrControl+Alt+R";
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
      fs.rm(file, { force: true }, () => {});
      setPhase("idle", { lastLink: "", lastFile: "", progress: 0 });
      openLibrary(`/v/${id}`);
      return;
    }
    const link = `${server}/v/${id}`;
    clipboard.writeText(link);
    shell.openExternal(link);
    setPhase("idle", { lastLink: link, progress: 0 });
  } catch (err) {
    const where = local ? "the local library" : "the server";
    setPhase("error", { error: `Couldn't add the video to ${where} (${err.cause?.code ?? err.message}). The recording is saved in ${libraryDir()}. Use “retry upload”.` });
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
ipcMain.on("library", (_e, pathname) => openLibrary(typeof pathname === "string" && pathname.startsWith("/") ? pathname : "/"));
ipcMain.on("model:retry", () => engine.ensureModel());
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
  createPanel();
  engine.on("status", broadcast);
  engine.ensureModel();
  engine.start().then(() => {
    if (engine.state === "ready" && !process.env.RECAP_SNAPSHOT) openLibrary();
    else if (engine.state !== "ready") panel.show();
  });

  const trayIcon = nativeImage.createFromPath(path.join(__dirname, "build", process.platform === "darwin" ? "trayTemplate.png" : "tray.png"));
  tray = new Tray(trayIcon);
  tray.setToolTip("Recap");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open library", click: () => openLibrary() },
      { label: "New recording…", click: () => panel.show() },
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
  // Dev aid: RECAP_SELFTEST=dir RECAP_SELFTEST_FILE=video pushes a file through the local pipeline.
  if (process.env.RECAP_SELFTEST) selftest(process.env.RECAP_SELFTEST, process.env.RECAP_SELFTEST_FILE);
});

async function selftest(dir, sample) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const report = { steps: [] };
  const step = (name, ok, extra = {}) => report.steps.push({ name, ok, ...extra });
  try {
    for (let i = 0; i < 200 && engine.state !== "ready"; i++) await wait(100);
    step("engine ready", engine.state === "ready", { url: engine.url, error: engine.error });
    for (let i = 0; i < 600 && engine.model.state !== "ready"; i++) await wait(100);
    step("model ready", engine.model.state === "ready");
    const auth = { Authorization: `Bearer ${engine.token}` };
    step("rejects requests without the launch secret", (await fetch(`${engine.url}/api/videos`)).status === 401);
    step("health", (await (await fetch(`${engine.url}/api/health`, { headers: auth })).json()).ok === true);

    // Same path as a real recording: the raw file goes through upload() into the local library.
    const raw = path.join(libraryDir(), "selftest.webm");
    fs.copyFileSync(sample, raw);
    session.opts = { server: "", title: "Self test" };
    await upload(raw);
    step("upload into local library", session.phase === "idle", { error: session.error });
    step("raw recording cleaned up", !fs.existsSync(raw));

    const list = await (await fetch(`${engine.url}/api/videos`, { headers: auth })).json();
    const video = list.find((v) => v.title === "Self test");
    let meta;
    for (let i = 0; i < 120; i++) {
      meta = (await (await fetch(`${engine.url}/api/videos/${video.id}`, { headers: auth })).json()).meta;
      if (meta.status === "ready" || meta.status === "error") break;
      await wait(1000);
    }
    const detail = await (await fetch(`${engine.url}/api/videos/${video.id}`, { headers: auth })).json();
    step("processed", meta.status === "ready", { error: meta.error, words: detail.transcript?.words?.length });
    report.transcript = detail.transcript?.words?.map((w) => w.text).join(" ");

    await wait(2500); // library window navigated to the video in upload()
    fs.writeFileSync(path.join(dir, "library-video.png"), (await library.webContents.capturePage()).toPNG());
    openLibrary("/");
    await wait(2500);
    fs.writeFileSync(path.join(dir, "library-home.png"), (await library.webContents.capturePage()).toPNG());
    openLibrary("/settings");
    await wait(2000);
    fs.writeFileSync(path.join(dir, "library-settings.png"), (await library.webContents.capturePage()).toPNG());
  } catch (err) {
    step("exception", false, { error: String(err?.stack ?? err) });
  }
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

app.on("before-quit", () => {
  quitting = true;
  engine.stop();
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", (e) => e.preventDefault());
