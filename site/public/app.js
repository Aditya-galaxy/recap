// Point the main download button at this visitor's OS.
(() => {
  const btn = document.getElementById("dl-primary");
  const base = "https://github.com/Aditya-galaxy/recap/releases/latest/download/";
  const ua = navigator.userAgent;
  const platform = navigator.userAgentData?.platform ?? navigator.platform ?? "";
  if (/Mac/i.test(platform) || /Macintosh/.test(ua)) {
    btn.href = base + "Recap-mac-arm64.dmg";
    btn.textContent = "download for macOS";
  } else if (/Win/i.test(platform) || /Windows/.test(ua)) {
    btn.href = base + "Recap-windows-x64-setup.exe";
    btn.textContent = "download for Windows";
  } else if (/Linux/i.test(platform) && !/Android/i.test(ua)) {
    btn.href = base + "Recap-linux-x86_64.AppImage";
    btn.textContent = "download for Linux";
  }
})();

// Recap Cloud founding spots: real numbers from the cloud server. Stays hidden if it can't be reached.
(async () => {
  const CLOUD = "https://app.recap.kronagent.dev";
  try {
    const r = await fetch(CLOUD + "/api/public/stats", { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return;
    const { limit, left } = await r.json();
    if (!Number.isInteger(limit) || !Number.isInteger(left)) return;
    document.getElementById("founding-limit").textContent = limit;
    document.getElementById("founding-left").textContent = left > 0 ? `${left} of ${limit}` : "All";
    document.getElementById("founding-text").textContent = left > 0 ? "founding spots left" : `${limit} founding spots are taken`;
    document.getElementById("founding-bar").style.width = `${Math.round(((limit - left) / limit) * 100)}%`;
    if (left === 0) document.getElementById("founding-cta").textContent = "sign up for Recap Cloud";
    document.getElementById("founding").hidden = false;
  } catch {
    /* cloud unreachable: keep the section hidden */
  }
})();

const form = document.getElementById("signup");
const status = document.getElementById("status");
const button = form.querySelector("button");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = form.email.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    status.textContent = "Enter a valid email address.";
    form.email.focus();
    return;
  }
  button.disabled = true;
  status.classList.remove("ok");
  status.textContent = "…";
  try {
    const res = await fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        website: form.website.value,
        interest: document.querySelector('input[name="interest"]:checked')?.value,
        source: new URLSearchParams(location.search).get("ref") || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    form.reset();
    status.classList.add("ok");
    status.textContent = "✓ You're on the list. We'll email you about new releases.";
  } catch (err) {
    status.textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

const fb = document.getElementById("fb");
const fbStatus = document.getElementById("fb-status");
fb.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = fb.querySelector("button");
  btn.disabled = true;
  fbStatus.classList.remove("ok");
  fbStatus.textContent = "…";
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
    fbStatus.classList.add("ok");
    fbStatus.textContent = "✓ Thanks, it's been received and will be read.";
  } catch (err) {
    fbStatus.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});
