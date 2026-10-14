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
