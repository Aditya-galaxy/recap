// Download gate: visitors leave an email, then the download for their OS starts right away.
// Someone who already gave their email on this browser just gets the download.

const RELEASES = "https://github.com/Aditya-galaxy/recap/releases/latest/download/";

function detectOs() {
  const ua = navigator.userAgent;
  const platform = navigator.userAgentData?.platform ?? navigator.platform ?? "";
  if (/Mac/i.test(platform) || /Macintosh/.test(ua)) return { os: "mac", name: "macOS", file: "Recap-mac-arm64.dmg" };
  if (/Win/i.test(platform) || /Windows/.test(ua)) return { os: "windows", name: "Windows", file: "Recap-windows-x64-setup.exe" };
  if (/Linux/i.test(platform) && !/Android/i.test(ua)) return { os: "linux", name: "Linux", file: "Recap-linux-x86_64.AppImage" };
  return { os: "other", name: "", file: "" };
}
const target = detectOs();

// The Mac build is Apple silicon only. Chrome and Firefox name the GPU, which tells Intel Macs apart;
// Safari hides it, so those visitors just see the "Apple silicon" note.
function intelMac() {
  if (target.os !== "mac") return false;
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const info = gl && gl.getExtension("WEBGL_debug_renderer_info");
    return !!info && /Intel|AMD|Radeon|NVIDIA|GeForce/i.test(String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)));
  } catch {
    return false;
  }
}
if (intelMac()) Object.assign(target, { os: "mac-intel", name: "", file: "" });
const downloadUrl = target.file ? RELEASES + target.file : "https://github.com/Aditya-galaxy/recap/releases/latest";

const KEY = "recap_download_ok";
const store = {
  get() {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  },
  set() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* private mode: they'll just be asked again next time */
    }
  },
};

function showReady(gate) {
  const ready = document.getElementById("ready").content.cloneNode(true);
  ready.querySelector("[data-primary]").href = downloadUrl;
  // Phones and tablets can't install it: point them at their computer instead.
  if (target.os === "mac-intel") ready.querySelector(".ready-title").textContent = "You're on the list. We'll email you when Recap runs on Intel Macs.";
  else if (!target.file) ready.querySelector(".ready-title").textContent = "You're in. Open this page on your computer to install Recap.";
  gate.replaceChildren(ready);
}

function startDownload() {
  // A download link doesn't navigate away. Phones and Intel Macs get nothing to download.
  if (target.file) location.href = downloadUrl;
}

for (const gate of document.querySelectorAll("[data-gate]")) {
  const form = gate.querySelector("form");
  const status = gate.querySelector("[data-status]");
  const button = gate.querySelector("[data-label]");
  if (target.name) button.textContent = `Download for ${target.name}`;
  if (target.os === "mac-intel") button.textContent = "Notify me";
  if (target.os === "mac") status.textContent = "Free and open source. For Macs with Apple silicon (M1 or newer).";
  if (target.os === "mac-intel") status.textContent = "Recap needs a Mac with Apple silicon (M1 or newer) for now. Leave your email and we'll tell you when Intel Macs are supported.";
  else if (!target.file) status.textContent = "Recap is a desktop app for Mac, Windows and Linux. Open this page on your computer to install it.";

  // Already signed up on this browser: no second ask.
  if (store.get()) {
    form.email.closest("form").classList.add("known");
    form.email.remove();
    form.querySelector(".hp").remove();
    if (target.os !== "mac" && target.os !== "mac-intel") status.textContent = "Free and open source.";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (store.get()) {
      startDownload();
      showReady(gate);
      return;
    }
    const email = form.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      status.classList.add("err");
      status.textContent = "Enter a valid email address.";
      form.email.focus();
      return;
    }
    button.disabled = true;
    status.classList.remove("err");
    status.textContent = "One moment…";
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          website: form.website.value,
          interest: "download",
          os: target.os,
          source: new URLSearchParams(location.search).get("ref") || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      store.set();
      startDownload();
      showReady(gate);
    } catch (err) {
      status.classList.add("err");
      status.textContent = err.message;
      button.disabled = false;
    }
  });
}

const fb = document.getElementById("fb");
const fbStatus = document.getElementById("fb-status");
fb.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = fb.querySelector("button");
  btn.disabled = true;
  fbStatus.textContent = "Sending…";
  try {
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: fb.message.value,
        email: fb.email.value,
        kind: fb.querySelector('input[name="kind"]:checked')?.value,
        website: fb.website.value,
        where: "site",
        page: location.pathname,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    fb.reset();
    fbStatus.textContent = "Thanks, it's been received and will be read.";
  } catch (err) {
    fbStatus.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});
