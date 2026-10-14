"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export default function AuthForm({ mode, firstUser = false, needsSetupCode = false }: { mode: "login" | "signup"; firstUser?: boolean; needsSetupCode?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkEmail, setCheckEmail] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form)),
    });
    if (!res.ok) {
      setBusy(false);
      setError((await res.json().catch(() => ({}))).error ?? "Something went wrong.");
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (mode === "signup" && body.verificationSent) {
      setBusy(false);
      setCheckEmail(body.email);
      return;
    }
    const next = params.get("next");
    // Only plain same-site paths ("//host", "/\\host" and control characters can leave the site).
    router.replace(next && /^\/(?![/\\])[^\\\s\x00-\x1f]*$/.test(next) ? next : "/");
    router.refresh();
  }

  const input = "w-full rounded-sm border border-border bg-surface px-3 py-2 outline-none focus:border-border-strong";
  if (checkEmail) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16 text-[13px]">
        <h1 className="text-lg font-medium">check your email</h1>
        <p className="mt-3">We sent a confirmation link to <span className="font-medium">{checkEmail}</span>.</p>
        <p className="mt-2 text-muted">Confirm it to activate your account and claim your spot. It can take a minute; check spam too.</p>
        <button className="btn-ghost mt-6" onClick={() => { router.replace("/"); router.refresh(); }}>continue</button>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-lg font-medium">{mode === "login" ? "sign in" : firstUser ? "create the admin account" : "create an account"}</h1>
      {firstUser && (
        <p className="mt-2 text-[12px] text-muted">
          This is a fresh Recap server. The first account becomes the admin and takes ownership of any existing videos.
        </p>
      )}
      <form onSubmit={submit} className="card mt-6 space-y-4 p-5">
        {needsSetupCode && (
          <label className="block">
            <span className="label mb-1.5 block">setup code</span>
            <input name="setupCode" required autoComplete="off" className={input} />
            <span className="mt-1 block text-[11px] text-muted">the SETUP_CODE this server was started with</span>
          </label>
        )}
        {mode === "signup" && (
          <label className="block">
            <span className="label mb-1.5 block">name</span>
            <input name="name" autoComplete="name" className={input} />
          </label>
        )}
        <label className="block">
          <span className="label mb-1.5 block">email</span>
          <input name="email" type="email" required autoComplete="email" className={input} />
        </label>
        <label className="block">
          <span className="label mb-1.5 block">password</span>
          <input
            name="password"
            type="password"
            required
            minLength={mode === "signup" ? 10 : undefined}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className={input}
          />
          {mode === "signup" && <span className="mt-1 block text-[11px] text-muted">at least 10 characters</span>}
          {mode === "login" && <Link href="/forgot" className="mt-1 block text-[11px] text-muted underline">forgot password?</Link>}
        </label>
        {error && (
          <p className="rounded-sm border border-border-strong p-2.5 text-[12px]">
            <span className="text-muted">error: </span>
            {error}
          </p>
        )}
        <button className="btn-primary w-full py-2.5" disabled={busy}>
          {busy ? "…" : mode === "login" ? "sign in" : "create account"}
        </button>
      </form>
      {!firstUser && (
        <p className="mt-4 text-center text-[12px] text-muted">
          {mode === "login" ? (
            <>
              no account? <Link href="/signup" className="text-text underline">sign up</Link>
            </>
          ) : (
            <>
              have an account? <Link href="/login" className="text-text underline">sign in</Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
