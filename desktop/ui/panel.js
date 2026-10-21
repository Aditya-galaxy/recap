// Settings UI + the MediaRecorder. The panel window hides while recording but keeps running
// (backgroundThrottling is off), so the recorder lives here rather than in a hidden extra window.
const $ = (id) => document.getElementById(id);

// server "" = record into the local library (the default); a URL = upload to a self-hosted Recap server.
const DEFAULTS = { mode: "screenCam", cameraId: "", micId: "", micOn: true, systemAudio: true, bubbleSize: "m", bubbleShape: "circle", bubblePx: null, displayId: "", server: "" };
let settings = { ...DEFAULTS };
try {
  settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem("settings") || "{}") };
} catch {}
// v0.2 defaulted to a server on localhost; v0.3 has the engine built in.
if (settings.server === "http://localhost:3217") settings.server = "";
const save = () => {
  try { localStorage.setItem("settings", JSON.stringify(settings)); } catch {}
};

let state = { phase: "idle" };
let devicesLoaded = false;
let platform = "";

// ---- settings UI ---------------------------------------------------------------

function bindSeg(id, key) {
  const el = $(id);
  el.addEventListener("click", (e) => {
    const v = e.target.closest("button")?.dataset.v;
    if (!v) return;
    settings[key] = v;
    save();
    render();
    // Size and shape also apply to a recording in progress. Picking a size replaces a dragged one.
    if (key === "bubbleSize") {
      settings.bubblePx = null;
      save();
      window.recap.bubbleSize(v);
    }
    if (key === "bubbleShape") window.recap.bubbleShape(v);
  });
}
function bindSwitch(id, key) {
  $(id).addEventListener("click", () => {
    settings[key] = !settings[key];
    save();
    render();
  });
}
function bindSelect(id, key) {
  $(id).addEventListener("change", (e) => {
    settings[key] = e.target.value;
    save();
  });
}
bindSeg("mode", "mode");
bindSeg("bubbleSize", "bubbleSize");
bindSeg("bubbleShape", "bubbleShape");
bindSwitch("micOn", "micOn");
bindSwitch("systemAudio", "systemAudio");
bindSelect("display", "displayId");
bindSelect("camera", "cameraId");
bindSelect("mic", "micId");
$("server").value = settings.server;
$("server").addEventListener("change", (e) => {
  settings.server = e.target.value.trim();
  save();
  window.recap.setStorage(settings.server);
  render();
  checkConnection();
});

function fillSelect(sel, options, current) {
  sel.innerHTML = "";
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.id;
    opt.textContent = o.name;
    sel.appendChild(opt);
  }
  if (options.some((o) => o.id === current)) sel.value = current;
  return sel.value;
}

async function loadDevices() {
  let devices = await navigator.mediaDevices.enumerateDevices();
  // Device labels stay blank until media permission has been granted once.
  if (!devices.some((d) => d.label) && !location.search.includes("snapshot")) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      s.getTracks().forEach((t) => t.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {}
  }
  const cams = devices.filter((d) => d.kind === "videoinput").map((d, i) => ({ id: d.deviceId, name: d.label || `Camera ${i + 1}` }));
  const mics = devices.filter((d) => d.kind === "audioinput" && d.deviceId !== "communications").map((d, i) => ({ id: d.deviceId, name: d.label || `Microphone ${i + 1}` }));
  settings.cameraId = fillSelect($("camera"), cams, settings.cameraId);
  settings.micId = fillSelect($("mic"), mics, settings.micId);
  const displays = await window.recap.displays();
  settings.displayId = fillSelect($("display"), displays, settings.displayId);
  $("displayField").hidden = displays.length < 2 || settings.mode === "cam";
  save();
}
// Video-call apps add and remove virtual cameras and mics. While recording, leave the devices alone (re-reading
// them can ask for the camera again) and catch up once the recording ends.
let devicesChanged = false;
navigator.mediaDevices.addEventListener("devicechange", () => {
  if (!devicesLoaded) return;
  if (rec) devicesChanged = true;
  else loadDevices();
});

function render() {
  for (const b of $("mode").children) b.setAttribute("aria-pressed", String(b.dataset.v === settings.mode));
  for (const b of $("bubbleSize").children) b.setAttribute("aria-pressed", String(!settings.bubblePx && b.dataset.v === settings.bubbleSize));
  for (const b of $("bubbleShape").children) b.setAttribute("aria-pressed", String(b.dataset.v === settings.bubbleShape));
  $("micOn").setAttribute("aria-checked", String(settings.micOn));
  $("systemAudio").setAttribute("aria-checked", String(settings.systemAudio && platform === "win32"));
  $("mic").hidden = !settings.micOn;
  $("cameraField").hidden = settings.mode === "screen";
  $("bubbleField").hidden = settings.mode !== "screenCam";
  $("displayField").hidden = $("display").options.length < 2 || settings.mode === "cam";
  // System audio loopback is a Windows feature in Chromium's desktop capture.
  $("sysAudioRow").hidden = settings.mode === "cam" || platform !== "win32";
  $("sysAudioNote").hidden = settings.mode === "cam" || platform !== "linux";

  const local = !settings.server;
  $("tokenField").hidden = local;
  const eng = state.engine;
  let engineMsg = "";
  if (local && eng) {
    if (eng.state === "error") engineMsg = eng.error;
    else if (eng.state !== "ready") engineMsg = "Getting ready…";
    else if (eng.model?.state === "downloading") engineMsg = `Setting up transcription: ${Math.round(eng.model.progress * 100)}% (one-time 140 MB download)`;
    else if (eng.model?.state === "error") engineMsg = eng.model.error;
  }
  $("engineStatus").hidden = !engineMsg;
  $("engineText").textContent = engineMsg;
  $("modelProgress").style.width = `${((eng?.model?.state === "downloading" && eng.model.progress) || 0) * 100}%`;
  $("retryModel").hidden = eng?.model?.state !== "error";
  const engineBlocked = local && (!eng || eng.state !== "ready" || eng.model?.state === "downloading");

  const busy = !["idle", "error"].includes(state.phase);
  $("start").disabled = busy || engineBlocked;
  $("error").hidden = state.phase !== "error";
  if (state.phase === "error") {
    $("error").innerHTML = "";
    const msg = document.createElement("div");
    msg.append(state.error);
    $("error").append(msg);
    if (state.lastFile && /retry/.test(state.error)) {
      const b = document.createElement("button");
      b.className = "btn";
      b.style.marginTop = "8px";
      b.textContent = "retry upload";
      b.onclick = () => window.recap.retryUpload();
      $("error").append(b);
    }
  }
  $("status").hidden = !["finishing", "uploading"].includes(state.phase);
  $("statusText").textContent = state.phase === "uploading" ? `Uploading ${Math.round(state.progress * 100)}%` : "Saving your recording…";
  $("progress").style.width = `${(state.progress || 0) * 100}%`;
  $("lastField").hidden = !state.lastLink;
  $("update").hidden = !state.update;
  if (state.update) $("updateText").textContent = `Recap ${state.update.version} is available.`;
  $("lastLink").textContent = state.lastLink || "";
}

$("start").onclick = () => startRecording();
$("copy").onclick = () => window.recap.copy(state.lastLink);
$("openLink").onclick = () => window.recap.open(state.lastLink);
$("library").onclick = () => (settings.server ? window.recap.open(settings.server) : window.recap.openLibrary("/"));
$("retryModel").onclick = () => window.recap.retryModel();
$("folder").onclick = () => window.recap.open("folder");
$("updateLink").onclick = () => state.update && window.recap.open(state.update.url);
$("toggleServer").onclick = () => ($("serverField").hidden = !$("serverField").hidden);
$("token").addEventListener("change", async (e) => {
  await window.recap.setToken(e.target.value);
  e.target.value = "";
  e.target.placeholder = "saved (encrypted). paste to replace";
  checkConnection();
});
$("check").onclick = () => checkConnection();
async function checkConnection() {
  $("connStatus").textContent = "checking…";
  const r = await window.recap.checkConnection(settings.server);
  $("connStatus").textContent = r.message;
}
window.recap.hasToken().then((has) => {
  if (has) $("token").placeholder = "saved (encrypted). paste to replace";
  if (settings.server && !has) {
    $("serverField").hidden = false;
    $("connStatus").textContent = "not connected";
  }
});

async function startRecording() {
  if (!["idle", "error"].includes(state.phase)) return;
  // The hotkey can start a recording before the panel was ever opened: list devices first.
  if (!devicesLoaded) {
    devicesLoaded = true;
    await loadDevices();
    render();
  }
  const opts = { ...settings, title: $("title").value };
  // No camera connected: screen+cam degrades to screen-only; camera-only can't start.
  if (opts.mode !== "screen" && $("camera").options.length === 0) {
    if (opts.mode === "cam") {
      state = { ...state, phase: "error", error: "No camera found. Connect one, or choose screen." };
      return render();
    }
    opts.mode = "screen";
  }
  window.recap.start(opts);
}

function captureError(err) {
  const what = err.what ?? "screen or camera";
  if (err.name === "NotAllowedError" && platform === "win32" && (what === "camera" || what === "microphone")) {
    return `Windows is blocking the ${what}. Open Settings → Privacy & security → ${what === "camera" ? "Camera" : "Microphone"}, turn on “Let desktop apps access your ${what}”, then try again.`;
  }
  if (err.name === "NotAllowedError") return `Recap isn't allowed to use the ${what}. Check your system's privacy settings, then try again.`;
  if (err.name === "NotFoundError" || err.name === "OverconstrainedError") return `No ${what} found. Check it's connected${err.what === "microphone" ? ", or turn the microphone off" : ""}.`;
  if (err.name === "NotReadableError") return `The ${what} is busy in another app (a video call?). Close it and try again.`;
  return `Couldn't start recording (${err.message || err.name}).`;
}

window.recap.on("state", (s) => {
  const wasUploading = state.phase === "uploading";
  state = s;
  platform = s.platform;
  // Remember a size dragged or a shape switched on the bubble itself during a recording.
  if (s.bubbleOn && (s.bubblePx !== settings.bubblePx || s.bubbleShape !== settings.bubbleShape)) {
    settings.bubblePx = s.bubblePx;
    settings.bubbleShape = s.bubbleShape;
    save();
  }
  $("hotkey").textContent = s.hotkey;
  if (wasUploading && s.phase === "idle") $("title").value = "";
  render();
});
window.recap.on("hotkey", startRecording);

// ---- recorder ----------------------------------------------------------------

let rec = null;
let streams = [];
let audioCtx = null;
let writes = Promise.resolve();
let discarding = false;
let accumulated = 0;
let segStart = 0;
let ticker = null;

const elapsed = () => (accumulated + (segStart ? performance.now() - segStart : 0)) / 1000;

function cleanup() {
  clearInterval(ticker);
  streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  streams = [];
  audioCtx?.close().catch(() => {});
  audioCtx = null;
  rec = null;
  if (devicesChanged) {
    devicesChanged = false;
    loadDevices();
  }
}

// Windows hands a camera (or the screen) back slowly after another app or window let go of it, so a
// "busy" error right at the start is often gone a moment later. Retry those before giving up.
async function getMedia(constraints, what) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      const transient = err.name === "NotReadableError" || err.name === "AbortError";
      if (!transient || attempt >= 3) {
        err.what ??= what;
        throw err;
      }
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
}

window.recap.on("begin", async (o) => {
  discarding = false;
  try {
    let video;
    const desktop = { chromeMediaSource: "desktop", chromeMediaSourceId: o.sourceId };
    if (o.mode === "cam") {
      video = await getMedia({ video: { deviceId: o.cameraId ? { ideal: o.cameraId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } } }, "camera");
    } else {
      // Electron's desktop-capture constraints: no picker, no user-gesture requirement.
      video = await getMedia({ audio: false, video: { mandatory: { ...desktop, maxWidth: 2560, maxHeight: 1600, maxFrameRate: 30 } } }, "screen");
    }
    streams.push(video);

    // System audio separately (Windows): if this computer can't provide it, record the mic instead of failing.
    if (o.mode !== "cam" && o.systemAudio) {
      try {
        const sys = await navigator.mediaDevices.getUserMedia({
          audio: { mandatory: { chromeMediaSource: "desktop" } },
          video: { mandatory: { ...desktop, maxWidth: 320, maxHeight: 240, maxFrameRate: 1 } },
        });
        sys.getVideoTracks().forEach((t) => t.stop());
        streams.push(sys);
        if (sys.getAudioTracks().length) video = new MediaStream([...video.getVideoTracks(), ...sys.getAudioTracks()]);
      } catch {
        window.recap.recorder({ type: "notice", message: "Computer sound couldn't be recorded on this PC, so this recording has your microphone only." });
      }
    }

    const audioSources = [];
    if (video.getAudioTracks().length) audioSources.push(video);
    if (o.micOn) {
      let mic;
      try {
        mic = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: o.micId ? { ideal: o.micId } : undefined, echoCancellation: true, noiseSuppression: true },
        });
      } catch (err) {
        // Recording silently without the voice would be worse than not starting.
        err.what = "microphone";
        throw err;
      }
      streams.push(mic);
      audioSources.push(mic);
      // Another app (often a video call) can take the microphone mid-recording.
      mic.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (rec && rec.state !== "inactive") window.recap.recorder({ type: "notice", message: "The microphone stopped, probably taken by another app. The rest of this recording may have no sound." });
      });
    }

    let audioTracks = [];
    if (audioSources.length === 1) {
      audioTracks = audioSources[0].getAudioTracks();
    } else if (audioSources.length > 1) {
      audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      for (const s of audioSources) audioCtx.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(dest);
      audioTracks = dest.stream.getAudioTracks();
    }

    // No mic and no system audio: add a silent track. Desktop capture only delivers frames when the screen
    // changes, so a still screen with no audio would otherwise produce a recording with no length (seen on
    // Windows). The audio keeps time; the engine skips transcription when it's all silence.
    if (!audioTracks.length) {
      audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      const silence = audioCtx.createConstantSource();
      silence.offset.value = 0;
      silence.connect(dest);
      silence.start();
      audioTracks = dest.stream.getAudioTracks();
    }

    const out = new MediaStream([...video.getVideoTracks(), ...audioTracks]);
    // Hardware H.264 first: measured 2.4x less CPU than VP9 at 1080p30 with no dropped frames (VP9 dropped
    // ~19%), and the engine can remux it instead of re-encoding. VP9/VP8 where H.264 isn't available.
    const mimeType = ["video/webm;codecs=h264,opus", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((t) =>
      MediaRecorder.isTypeSupported(t),
    );
    rec = new MediaRecorder(out, { mimeType, videoBitsPerSecond: 8_000_000 });
    writes = Promise.resolve();
    rec.ondataavailable = (e) => {
      if (!e.data.size || discarding) return;
      // Keep chunk order: arrayBuffer() is async.
      writes = writes.then(async () => window.recap.chunk(await e.data.arrayBuffer()));
    };
    rec.onstop = async () => {
      await writes;
      const discarded = discarding;
      cleanup();
      if (!discarded) window.recap.recorder({ type: "stopped" });
    };
    // Ending the share from the OS (e.g. the Wayland portal), or another app taking the camera, stops the
    // recording; what was recorded is kept.
    video.getVideoTracks()[0].addEventListener("ended", () => {
      if (!rec || rec.state === "inactive") return;
      if (o.mode === "cam") window.recap.recorder({ type: "notice", message: "The camera stopped, probably taken by another app, so the recording ended. What was recorded is saved." });
      rec.stop();
    });

    rec.start(1000);
    accumulated = 0;
    segStart = performance.now();
    ticker = setInterval(() => window.recap.recorder({ type: "elapsed", value: elapsed() }), 250);
    window.recap.recorder({ type: "started" });
  } catch (err) {
    cleanup();
    window.recap.recorder({ type: "error", message: captureError(err) });
  }
});

window.recap.on("control", (action) => {
  if (action === "discard") {
    discarding = true;
    if (rec && rec.state !== "inactive") rec.stop();
    else cleanup();
    return;
  }
  if (!rec) return;
  if (action === "pause" && rec.state === "recording") {
    rec.pause();
    accumulated += performance.now() - segStart;
    segStart = 0;
    window.recap.recorder({ type: "paused" });
  } else if (action === "resume" && rec.state === "paused") {
    rec.resume();
    segStart = performance.now();
    window.recap.recorder({ type: "resumed" });
  } else if (action === "stop" && rec.state !== "inactive") {
    rec.stop();
  }
});

render();
window.recap.setStorage(settings.server);
// Enumerating devices starts the browser's camera/audio capture services (~80 MB). The panel lives hidden
// in the background, so only do it once someone actually opens it.
const ensureDevices = () => {
  if (devicesLoaded || document.visibilityState !== "visible") return;
  devicesLoaded = true;
  loadDevices().then(render);
};
document.addEventListener("visibilitychange", ensureDevices);
ensureDevices();
window.recap.requestState();
