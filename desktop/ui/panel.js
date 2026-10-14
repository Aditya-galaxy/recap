// Settings UI + the MediaRecorder. The panel window hides while recording but keeps running
// (backgroundThrottling is off), so the recorder lives here rather than in a hidden extra window.
const $ = (id) => document.getElementById(id);

const DEFAULTS = { mode: "screenCam", cameraId: "", micId: "", micOn: true, systemAudio: true, bubbleSize: "m", displayId: "", server: "http://localhost:3217" };
let settings = { ...DEFAULTS };
try {
  settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem("settings") || "{}") };
} catch {}
const save = () => {
  try { localStorage.setItem("settings", JSON.stringify(settings)); } catch {}
};

let state = { phase: "idle" };
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
bindSwitch("micOn", "micOn");
bindSwitch("systemAudio", "systemAudio");
bindSelect("display", "displayId");
bindSelect("camera", "cameraId");
bindSelect("mic", "micId");
$("server").value = settings.server;
$("server").addEventListener("change", (e) => {
  settings.server = e.target.value.trim() || DEFAULTS.server;
  save();
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
navigator.mediaDevices.addEventListener("devicechange", loadDevices);

function render() {
  for (const b of $("mode").children) b.setAttribute("aria-pressed", String(b.dataset.v === settings.mode));
  for (const b of $("bubbleSize").children) b.setAttribute("aria-pressed", String(b.dataset.v === settings.bubbleSize));
  $("micOn").setAttribute("aria-checked", String(settings.micOn));
  $("systemAudio").setAttribute("aria-checked", String(settings.systemAudio && platform === "win32"));
  $("mic").hidden = !settings.micOn;
  $("cameraField").hidden = settings.mode === "screen";
  $("bubbleField").hidden = settings.mode !== "screenCam";
  $("displayField").hidden = $("display").options.length < 2 || settings.mode === "cam";
  // System audio loopback is a Windows feature in Chromium's desktop capture.
  $("sysAudioRow").hidden = settings.mode === "cam" || platform !== "win32";
  $("sysAudioNote").hidden = settings.mode === "cam" || platform !== "linux";

  const busy = !["idle", "error"].includes(state.phase);
  $("start").disabled = busy;
  $("error").hidden = state.phase !== "error";
  if (state.phase === "error") {
    $("error").innerHTML = "";
    const msg = document.createElement("div");
    msg.innerHTML = '<span class="muted">error: </span>';
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
  $("statusText").textContent = state.phase === "uploading" ? `$ uploading ${Math.round(state.progress * 100)}%` : "$ saving…";
  $("progress").style.width = `${(state.progress || 0) * 100}%`;
  $("lastField").hidden = !state.lastLink;
  $("lastLink").textContent = state.lastLink || "";
}

$("start").onclick = () => startRecording();
$("copy").onclick = () => window.recap.copy(state.lastLink);
$("openLink").onclick = () => window.recap.open(state.lastLink);
$("library").onclick = () => window.recap.open(settings.server);
$("folder").onclick = () => window.recap.open("folder");
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
  if (has) {
    $("token").placeholder = "saved (encrypted). paste to replace";
  } else {
    $("serverField").hidden = false;
    $("connStatus").textContent = "not connected";
  }
});

function startRecording() {
  if (!["idle", "error"].includes(state.phase)) return;
  window.recap.start({ ...settings, title: $("title").value });
}

window.recap.on("state", (s) => {
  const wasUploading = state.phase === "uploading";
  state = s;
  platform = s.platform;
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
}

window.recap.on("begin", async (o) => {
  discarding = false;
  try {
    let video;
    if (o.mode === "cam") {
      video = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: o.cameraId ? { exact: o.cameraId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } else {
      // Electron's desktop-capture constraints: no picker, no user-gesture requirement.
      video = await navigator.mediaDevices.getUserMedia({
        audio: o.systemAudio ? { mandatory: { chromeMediaSource: "desktop" } } : false,
        video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: o.sourceId, maxWidth: 2560, maxHeight: 1600, maxFrameRate: 30 } },
      });
    }
    streams.push(video);

    const audioSources = [];
    if (video.getAudioTracks().length) audioSources.push(video);
    if (o.micOn) {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: o.micId ? { exact: o.micId } : undefined, echoCancellation: true, noiseSuppression: true },
      });
      streams.push(mic);
      audioSources.push(mic);
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

    const out = new MediaStream([...video.getVideoTracks(), ...audioTracks]);
    const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
    rec = new MediaRecorder(out, { mimeType, videoBitsPerSecond: 5_000_000 });
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
    // Ending the share from the OS (e.g. the Wayland portal) stops the recording.
    video.getVideoTracks()[0].addEventListener("ended", () => rec?.state !== "inactive" && rec?.stop());

    rec.start(1000);
    accumulated = 0;
    segStart = performance.now();
    ticker = setInterval(() => window.recap.recorder({ type: "elapsed", value: elapsed() }), 250);
    window.recap.recorder({ type: "started" });
  } catch (err) {
    cleanup();
    window.recap.recorder({ type: "error", message: `Couldn't start capture: ${err.message || err.name}` });
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
loadDevices().then(render);
window.recap.requestState();
