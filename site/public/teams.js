// "Recap for Teams" early-access form: same signup endpoint, with the team answers attached.
const form = document.getElementById("teams");
const status = document.getElementById("teams-status");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = form.email.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    status.textContent = "Enter a valid work email.";
    form.email.focus();
    return;
  }
  const button = form.querySelector("button");
  button.disabled = true;
  status.textContent = "One moment…";
  try {
    const res = await fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        interest: "teams",
        website: form.website.value,
        company: form.company.value.trim(),
        size: form.size.value,
        role: form.role.value,
        use: form.use.value,
        onprem: form.onprem.value,
        price: form.price.value,
        source: new URLSearchParams(location.search).get("ref") || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    form.replaceChildren(Object.assign(document.createElement("p"), {
      className: "ready-title",
      textContent: "Thanks. You're on the early-access list, and we'll email you soon.",
    }));
  } catch (err) {
    status.textContent = err.message;
    button.disabled = false;
  }
});
