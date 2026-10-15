import "server-only";
import { config } from "./config";

// Transactional email via Resend's HTTP API. Without RESEND_API_KEY (development, most self-hosted
// servers) messages are written to the server log instead, so every flow still works end to end.

interface Mail {
  to: string;
  subject: string;
  /** Plain-text body. Also used to build the HTML version. */
  text: string;
  /** Optional call-to-action button in the HTML version. */
  action?: { label: string; url: string };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function html({ text, action }: Mail) {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const button = action
    ? `<p style="margin:22px 0"><a href="${esc(action.url)}" style="background:#0a0a0a;color:#fafafa;padding:11px 18px;border-radius:3px;text-decoration:none;display:inline-block">${esc(action.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#fafafa">
<div style="max-width:520px;margin:0 auto;padding:32px 20px;font:15px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#0a0a0a">
<p style="margin:0 0 24px;font-weight:600;font-size:16px">recap</p>${paras}${button}
<p style="margin:28px 0 0;font-size:11px;color:#737373">Recap · open-source async video · recap.kronagent.dev</p>
</div></body></html>`;
}

export async function sendMail(mail: Mail): Promise<void> {
  const text = mail.action ? `${mail.text}\n\n${mail.action.label}: ${mail.action.url}` : mail.text;
  if (!config.resendApiKey) {
    console.log(`[email] (no RESEND_API_KEY, not sent) to=${mail.to} subject="${mail.subject}"\n${text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: config.emailFrom, to: [mail.to], subject: mail.subject, text, html: html(mail) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`email send failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

/** Fire-and-forget for notifications: a mail outage must never break the request that triggered it. */
export function notify(mail: Mail) {
  sendMail(mail).catch((err) => console.error("[email] notification failed:", err.message));
}
