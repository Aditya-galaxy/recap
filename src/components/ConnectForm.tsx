"use client";

import { useState } from "react";

/** Approve (or deny) the code the desktop app is showing. */
export default function ConnectForm({ initialCode, client, email, verified }: { initialCode: string; client: string | null; email: string; verified: boolean }) {
  const [code, setCode] = useState(initialCode);
  const [state, setState] = useState<"idle" | "busy" | "approved" | "denied">("idle");
  const [error, setError] = useState("");

  async function decide(approve: boolean) {
    setState("busy");
    setError("");
    const r = await fetch("/api/device/approve", { method: "POST", body: JSON.stringify({ userCode: code, approve }) });
    if (r.ok) return setState(approve ? "approved" : "denied");
    setState("idle");
    setError((await r.json().catch(() => ({}))).error ?? "Something went wrong.");
  }

  if (state === "approved")
    return (
      <Frame>
        <h1 className="text-lg font-medium">connected ✓</h1>
        <p className="text-[13px] text-muted">Go back to the Recap app. It can now share videos to your account. You can disconnect it any time in settings.</p>
      </Frame>
    );
  if (state === "denied")
    return (
      <Frame>
        <h1 className="text-lg font-medium">request denied</h1>
        <p className="text-[13px] text-muted">Nothing was connected.</p>
      </Frame>
    );
  return (
    <Frame>
      <h1 className="text-lg font-medium">connect the Recap app</h1>
      {!verified ? (
        <p className="text-[13px] text-muted">Confirm your email first (check your inbox), then reload this page.</p>
      ) : (
        <>
          <p className="text-[13px] text-muted">
            Check that this code matches the one in the app{client ? ` (${client})` : ""}. Approving lets it upload and share videos as <span className="text-text">{email}</span>.
          </p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX"
            maxLength={9}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-border bg-surface px-3 py-3 text-center text-xl tracking-[0.3em] outline-none focus:border-border-strong"
          />
          {error && <p className="text-[12px] text-muted">{error}</p>}
          <div className="flex gap-2">
            <button className="btn-primary flex-1 py-2.5" disabled={state === "busy" || code.replace(/[^A-Z]/g, "").length !== 8} onClick={() => decide(true)}>
              approve
            </button>
            <button className="btn-ghost py-2.5" disabled={state === "busy" || !code} onClick={() => decide(false)}>
              deny
            </button>
          </div>
          <p className="text-[11px] text-muted">Didn&apos;t start this from the Recap app? Deny it.</p>
        </>
      )}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-sm space-y-4 px-4 py-16">{children}</div>;
}
