"use client";

import { useState } from "react";

const KINDS = ["idea", "bug", "praise", "other"] as const;

/** Footer "feedback" link + dialog. Posts straight to the Recap project's feedback endpoint. */
export default function FeedbackButton({ url, where, version }: { url: string; where: "web" | "desktop"; version: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("idea");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const host = new URL(url).host;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, email, kind, where, version, page: location.pathname }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't send. Please try again.");
      setMessage("");
      setEmail("");
      setStatus({ ok: true, text: "✓ Sent. Thank you!" });
    } catch (err) {
      setStatus({ ok: false, text: (err as Error).message === "Failed to fetch" ? "Couldn't reach the feedback server. Are you offline?" : (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-sm border border-border bg-surface px-3 py-2 outline-none focus:border-border-strong";
  return (
    <>
      <button className="underline" onClick={() => { setOpen(true); setStatus(null); }}>feedback</button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <form onSubmit={send} onClick={(e) => e.stopPropagation()} className="card w-full max-w-md space-y-3 p-5 text-[13px] text-text">
            <div className="flex items-baseline justify-between">
              <h2 className="font-medium">send feedback</h2>
              <button type="button" className="text-muted hover:text-text" onClick={() => setOpen(false)} aria-label="close">✕</button>
            </div>
            <div className="grid grid-cols-4 gap-0.5 rounded-sm border border-border p-0.5 text-[12px]">
              {KINDS.map((k) => (
                <button
                  type="button"
                  key={k}
                  onClick={() => setKind(k)}
                  className={`rounded-sm py-1 ${kind === k ? "bg-accent text-accent-text" : "text-muted hover:text-text"}`}
                >
                  {k}
                </button>
              ))}
            </div>
            <textarea
              autoFocus
              required
              minLength={3}
              maxLength={4000}
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="what's broken, missing, or great?"
              className={input}
            />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email (optional, for a reply)" className={input} />
            <p className="text-[11px] text-muted">
              Sent to {host} with your message, email (if given), app version and current page. No video or transcript is sent.
            </p>
            {status && <p className={`text-[12px] ${status.ok ? "" : "text-muted"}`}>{status.text}</p>}
            <button className="btn-primary w-full" disabled={busy || message.trim().length < 3}>{busy ? "sending…" : "send"}</button>
          </form>
        </div>
      )}
    </>
  );
}
