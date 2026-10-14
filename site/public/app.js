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
    status.textContent = "✓ You're on the list. We'll email you when the desktop app is ready.";
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
