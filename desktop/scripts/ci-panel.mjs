// CI helper: read the running app's recorder panel over the DevTools port.
// node scripts/ci-panel.mjs <port>  →  prints JSON { panel, updateShown, updateText, engine }
const port = process.argv[2] ?? "9333";
const deadline = Date.now() + 90_000;
let target;
while (!target && Date.now() < deadline) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((t) => t.url.includes("panel.html"));
  } catch {}
  if (!target) await new Promise((r) => setTimeout(r, 1000));
}
if (!target) {
  console.log(JSON.stringify({ panel: false }));
  process.exit(1);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
const expression = `({ panel: true, updateShown: !document.getElementById("update").hidden, updateText: document.getElementById("updateText").textContent, engine: document.getElementById("engineStatus").hidden ? "ready" : document.getElementById("engineText").textContent })`;
ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id !== 1) return;
  console.log(JSON.stringify(d.result?.result?.value ?? { panel: true, error: "evaluate failed" }));
  ws.close();
  process.exit(0);
};
