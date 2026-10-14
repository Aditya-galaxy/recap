"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const input = "w-full rounded-sm border border-border bg-surface px-3 py-2 outline-none focus:border-border-strong";

export function ForgotForm() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    await fetch("/api/auth/forgot", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))) }).catch(() => {});
    setBusy(false);
    setSent(true);
  }
  if (sent) {
    return <p className="card mt-6 p-5 text-[13px]">If that email has an account, a reset link is on its way. It works for 1 hour.</p>;
  }
  return (
    <form onSubmit={submit} className="card mt-6 space-y-4 p-5">
      <label className="block">
        <span className="label mb-1.5 block">email</span>
        <input name="email" type="email" required autoComplete="email" className={input} />
      </label>
      <button className="btn-primary w-full py-2.5" disabled={busy}>{busy ? "…" : "send reset link"}</button>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const password = String(new FormData(e.currentTarget).get("password"));
    const res = await fetch("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, password }) });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Something went wrong.");
    router.replace("/");
    router.refresh();
  }
  return (
    <form onSubmit={submit} className="card mt-6 space-y-4 p-5">
      <label className="block">
        <span className="label mb-1.5 block">new password</span>
        <input name="password" type="password" required minLength={10} autoComplete="new-password" className={input} />
        <span className="mt-1 block text-[11px] text-muted">at least 10 characters</span>
      </label>
      {error && (
        <p className="rounded-sm border border-border-strong p-2.5 text-[12px]">
          <span className="text-muted">error: </span>
          {error} {error.includes("expired") && <Link href="/forgot" className="underline">request a new link</Link>}
        </p>
      )}
      <button className="btn-primary w-full py-2.5" disabled={busy}>{busy ? "…" : "set password"}</button>
    </form>
  );
}
