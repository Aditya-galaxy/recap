"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ApiToken, User } from "@/lib/auth";
import { fmtDate } from "@/lib/format";

export default function Settings({ user, tokens: initial, server, signupOpen }: { user: User; tokens: ApiToken[]; server: string; signupOpen: boolean }) {
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

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div className="flex items-baseline justify-between border-b border-border pb-3">
        <h1 className="text-lg font-medium">settings</h1>
        <button className="btn-ghost" onClick={signOut}>sign out</button>
      </div>

      <section className="space-y-3">
        <h2 className="label">account</h2>
        <div className="card p-4 text-[13px]">
          {user.name && <p>{user.name}</p>}
          <p className="text-muted">{user.email}{user.isAdmin ? " · admin" : ""}</p>
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

      {user.isAdmin && (
        <section className="space-y-3">
          <h2 className="label">add a user</h2>
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
    </div>
  );
}
