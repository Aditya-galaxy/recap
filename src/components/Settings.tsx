"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CloudLinkCard } from "@/components/CloudShare";
import type { ApiToken, User } from "@/lib/auth";
import { fmtDate } from "@/lib/format";

type Account = { cloud: boolean; used: number; quota: number | null; founderLimit: number; foundersLeft: number; price: string };

const size = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`);

export default function Settings({
  account,
  user,
  tokens: initial,
  server,
  signupOpen,
  local,
}: {
  user: User;
  tokens: ApiToken[];
  server: string;
  signupOpen: boolean;
  local: { dataDir: string; model: string } | null;
  account: Account;
}) {
  const router = useRouter();
  const [tokens, setTokens] = useState(initial);
  const [fresh, setFresh] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [copied, setCopied] = useState("");
  const [msg, setMsg] = useState("");

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 1500);
  };

  async function create() {
    const r = await fetch("/api/tokens", { method: "POST", body: JSON.stringify({ name: name || "Desktop app" }) });
    if (!r.ok) return;
    const { token } = await r.json();
    setFresh(token);
    setName("");
    setTokens(await (await fetch("/api/tokens")).json());
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this token? Apps using it will stop uploading.")) return;
    await fetch(`/api/tokens/${id}`, { method: "DELETE" });
    setTokens(tokens.filter((t) => t.id !== id));
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
    router.refresh();
  }

  async function addUser(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const r = await fetch("/api/users", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? `created ${j.email}. Send them the password over a secure channel.` : `error: ${j.error}`);
    if (r.ok) form.reset();
  }

  const input = "w-full rounded-sm border border-border bg-surface px-3 py-2 outline-none focus:border-border-strong";

  if (local) {
    return (
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
        <div className="border-b border-border pb-3">
          <h1 className="text-lg font-medium">settings</h1>
        </div>
        <section className="space-y-3">
          <h2 className="label">running locally</h2>
          <div className="card space-y-3 p-4 text-[13px]">
            <p>Recordings, transcripts and clean-ups stay on this computer. Nothing is uploaded unless you share a video.</p>
            <p className="text-muted">library: <code className="text-text">{local.dataDir}</code></p>
            <p className="text-muted">transcription model: <code className="text-text">{local.model.split(/[\\/]/).pop()}</code></p>
          </div>
        </section>
        <section className="space-y-3">
          <h2 className="label">sharing</h2>
          <CloudLinkCard />
          <p className="text-[12px] text-muted">
            Or use <span className="text-text">export</span> on any video to save the MP4 and send it yourself. Running your own server works too:
            one <code>docker compose up</code>, then point the recorder&apos;s <span className="text-text">server</span> setting at it.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div className="flex items-baseline justify-between border-b border-border pb-3">
        <h1 className="text-lg font-medium">settings</h1>
        <button className="btn-ghost" onClick={signOut}>sign out</button>
      </div>

      <section className="space-y-3">
        <h2 className="label">account</h2>
        <div className="card space-y-4 p-4 text-[13px]">
          <div>
            {user.name && <p>{user.name}</p>}
            <p className="text-muted">{user.email}{user.isAdmin ? " · admin" : ""}{user.emailVerified ? "" : " · not confirmed yet"}</p>
          </div>
          {account.cloud && (
            <div className="border-t border-border pt-4">
              {user.founderNumber ? (
                <p>
                  <span className="rounded-sm bg-accent px-1.5 py-0.5 text-[11px] text-accent-text">founding member #{user.founderNumber}</span>
                  <span className="ml-2 text-muted">free for life, with fair-use limits</span>
                </p>
              ) : (
                <p className="text-muted">
                  standard plan{account.foundersLeft > 0 ? ` · confirm your email to claim one of the ${account.foundersLeft} founding spots left` : ` · paid plan (${account.price}) coming soon`}
                </p>
              )}
              {account.quota !== null && (
                <div className="mt-3">
                  <div className="flex justify-between text-[11px] text-muted">
                    <span>storage</span>
                    <span>{size(account.used)} of {size(account.quota)}</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full bg-accent" style={{ width: `${Math.min(100, (account.used / account.quota) * 100)}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="label">email me when</h2>
        <div className="card space-y-3 p-4 text-[13px]">
          {([
            ["notifyComments", "someone comments on my video", user.notifyComments],
            ["notifyViews", "someone watches my video for the first time", user.notifyViews],
          ] as const).map(([key, label, initial]) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                defaultChecked={initial}
                onChange={(e) => fetch("/api/me", { method: "PATCH", body: JSON.stringify({ [key]: e.target.checked }) })}
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="label">connect the desktop apps</h2>
        <div className="card space-y-4 p-4 text-[13px]">
          <p className="text-muted">
            In the Mac, Windows or Linux app, open <span className="text-text">server</span> and paste these two values.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-sm border border-border px-3 py-2">{server}</code>
            <button className="btn-ghost" onClick={() => copy(server, "server")}>{copied === "server" ? "copied ✓" : "copy"}</button>
          </div>
          {fresh ? (
            <div className="space-y-2 rounded-sm border border-border-strong p-3">
              <p className="text-[12px]">New token. Copy it now; it won&apos;t be shown again.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate">{fresh}</code>
                <button className="btn-primary" onClick={() => copy(fresh, "token")}>{copied === "token" ? "copied ✓" : "copy"}</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="token name, e.g. work laptop" className={input} />
              <button className="btn-primary shrink-0" onClick={create}>create token</button>
            </div>
          )}
          {tokens.length > 0 && (
            <ul className="divide-y divide-border border-t border-border">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span>
                    {t.name} <span className="text-muted">· {t.prefix}…</span>
                    <span className="block text-[11px] text-muted">
                      created {fmtDate(t.createdAt)} · {t.lastUsedAt ? `last used ${fmtDate(t.lastUsedAt)}` : "never used"}
                    </span>
                  </span>
                  <button className="btn-danger" onClick={() => revoke(t.id)}>revoke</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="label">security</h2>
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4 text-[13px]">
          <span className="text-muted">Change your password with a reset link sent to {user.email}.</span>
          <button
            className="btn-ghost"
            onClick={async () => {
              await fetch("/api/auth/forgot", { method: "POST", body: JSON.stringify({ email: user.email }) });
              setMsg("Reset link sent. Check your email.");
            }}
          >
            email me a reset link
          </button>
        </div>
      </section>

      {user.isAdmin && (
        <section className="space-y-3">
          <h2 className="label">moderation</h2>
          <p className="text-[13px] text-muted">
            Reported videos land in the <a href="/admin" className="text-text underline">review queue</a>; you&apos;ll get an email when a video gets its first report.
          </p>
          <h2 className="label pt-3">add a user</h2>
          <form onSubmit={addUser} className="card grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]">
            <input name="email" type="email" required placeholder="email" className={input} />
            <input name="password" type="text" required minLength={10} placeholder="temporary password" className={input} />
            <button className="btn-primary">add</button>
            {msg && <p className="text-[12px] text-muted sm:col-span-3">{msg}</p>}
            <p className="text-[11px] text-muted sm:col-span-3">
              public sign-up is {signupOpen ? "open" : "closed"} (set ALLOW_SIGNUP={signupOpen ? "false" : "true"} to change).
            </p>
          </form>
        </section>
      )}
      <section className="space-y-3">
        <h2 className="label">danger zone</h2>
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4 text-[13px]">
          <span className="text-muted">Delete your account and every video in it. This can&apos;t be undone.</span>
          <button
            className="btn-danger"
            onClick={async () => {
              const password = prompt("Type your password to delete your account and all your videos permanently:");
              if (!password) return;
              const r = await fetch("/api/me", { method: "DELETE", body: JSON.stringify({ password }) });
              if (r.ok) {
                router.replace("/");
                router.refresh();
              } else setMsg((await r.json().catch(() => ({}))).error ?? "Couldn't delete the account.");
            }}
          >
            delete account
          </button>
        </div>
        {msg && <p className="text-[12px] text-muted">{msg}</p>}
      </section>
    </div>
  );
}
