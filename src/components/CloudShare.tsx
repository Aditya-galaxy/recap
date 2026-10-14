"use client";

import { useCallback, useEffect, useState } from "react";

// Desktop app: connect the local library to Recap Cloud, and share videos from it as links.

type Status =
  | { state: "connected"; url: string; email: string }
  | { state: "pending"; url: string; userCode: string; verifyUrl: string }
  | { state: "disconnected"; url: string; error?: string };

function useCloudStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const refresh = useCallback(() => {
    fetch("/api/cloud")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ state: "disconnected", url: "", error: "The local engine isn't answering." }));
  }, []);
  useEffect(refresh, [refresh]);
  // While waiting for approval in the browser, check every 3 s.
  useEffect(() => {
    if (status?.state !== "pending") return;
    const t = setTimeout(refresh, 3000);
    return () => clearTimeout(t);
  }, [status, refresh]);
  return { status, setStatus, refresh };
}

export function CloudLinkCard() {
  const { status, setStatus, refresh } = useCloudStatus();
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    const r = await fetch("/api/cloud", { method: "POST" });
    const s = (await r.json().catch(() => null)) as Status | null;
    setBusy(false);
    setStatus(s);
    if (s?.state === "pending") window.open(s.verifyUrl, "_blank");
  }

  async function disconnect() {
    if (!confirm("Disconnect from Recap Cloud? Videos you already shared stay online; manage them on the website.")) return;
    await fetch("/api/cloud", { method: "DELETE" });
    refresh();
  }

  if (!status) return <div className="card p-4 text-[13px] text-muted">checking…</div>;
  const host = status.url ? new URL(status.url).host : "";
  return (
    <div className="card space-y-3 p-4 text-[13px]">
      {status.state === "connected" ? (
        <>
          <p>
            Connected to <span className="text-text">{host}</span> as <span className="text-text">{status.email}</span>. Open a video and use{" "}
            <span className="text-text">share link</span>. Videos upload with the transcript made on this computer.
          </p>
          <div className="flex gap-2">
            <a className="btn-ghost" href={status.url} target="_blank" rel="noreferrer">open {host}</a>
            <button className="btn-ghost" onClick={disconnect}>disconnect</button>
          </div>
        </>
      ) : status.state === "pending" ? (
        <>
          <p>Approve this code in your browser (we opened it for you):</p>
          <p className="text-center text-2xl tracking-[0.3em]">{status.userCode}</p>
          <p className="text-[12px] text-muted">
            Browser didn&apos;t open? Go to{" "}
            <a className="underline" href={status.verifyUrl} target="_blank" rel="noreferrer">{host}/connect</a>. Waiting for approval…
          </p>
          <button className="btn-ghost" onClick={disconnect}>cancel</button>
        </>
      ) : (
        <>
          <p>
            Want share links with comments, reactions and viewer insights? Connect a free <span className="text-text">Recap Cloud</span> account.
            Only the videos you choose to share get uploaded.
          </p>
          {status.error && <p className="text-[12px] text-muted">{status.error}</p>}
          <button className="btn-primary" disabled={busy} onClick={connect}>{busy ? "…" : "connect Recap Cloud"}</button>
        </>
      )}
    </div>
  );
}

/** "share link" on a local video: upload to the connected cloud account, then copy the link. */
export function ShareToCloud({ videoId, version, canClean }: { videoId: string; version: "original" | "clean"; canClean: boolean }) {
  const [state, setState] = useState<{ url: string | null; sharedVersion: string | null; progress: { sent: number; total: number; error?: string } | null } | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const { status } = useCloudStatus();

  const load = useCallback(() => {
    fetch(`/api/videos/${videoId}/share`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setState({ url: d.url, sharedVersion: d.version, progress: d.progress }))
      .catch(() => {});
  }, [videoId]);
  useEffect(load, [load]);
  const uploading = !!state?.progress && !state.progress.error;
  useEffect(() => {
    if (!uploading) return;
    const t = setTimeout(load, 1000);
    return () => clearTimeout(t);
  }, [uploading, state, load]);

  async function start(v: "original" | "clean") {
    setError("");
    const r = await fetch(`/api/videos/${videoId}/share`, { method: "POST", body: JSON.stringify({ version: v }) });
    if (!r.ok) return setError((await r.json().catch(() => ({}))).error ?? "Couldn't start the upload.");
    load();
  }

  async function copy(url: string) {
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!open) return <button className="btn-ghost" onClick={() => setOpen(true)}>{state?.url ? "share link ✓" : "share link"}</button>;

  const pct = state?.progress ? Math.floor((state.progress.sent / Math.max(1, state.progress.total)) * 100) : 0;
  return (
    <div className="card w-full space-y-3 p-3 text-[12px] sm:w-80">
      <div className="flex items-center justify-between">
        <p className="label">share link</p>
        <button className="text-muted hover:text-text" onClick={() => setOpen(false)} aria-label="Close">✕</button>
      </div>
      {status?.state !== "connected" ? (
        <p className="text-muted">
          Connect Recap Cloud in <a className="text-text underline" href="/settings">settings</a> to share videos as links.
        </p>
      ) : uploading ? (
        <div className="space-y-1.5">
          <p>{pct < 100 ? `uploading… ${pct}%` : "finishing…"}</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : (
        <>
          {state?.url && (
            <div className="space-y-2">
              <p className="break-all text-text">{state.url}</p>
              <div className="flex gap-2">
                <button className="btn-primary" onClick={() => copy(state.url!)}>{copied ? "copied ✓" : "copy link"}</button>
                <a className="btn-ghost" href={state.url} target="_blank" rel="noreferrer">open</a>
              </div>
              <p className="text-muted">shared the {state.sharedVersion === "clean" ? "cleaned" : "original"} version</p>
            </div>
          )}
          {(state?.progress?.error || error) && <p className="text-muted">{state?.progress?.error || error}</p>}
          <div className="flex flex-wrap gap-2">
            <button className={state?.url ? "btn-ghost" : "btn-primary"} onClick={() => start(version)}>
              {state?.url ? "upload again" : `upload ${version === "clean" ? "cleaned" : "original"} & get link`}
            </button>
            {canClean && version === "original" && (
              <button className="btn-ghost" onClick={() => start("clean")}>upload cleaned</button>
            )}
          </div>
          <p className="text-muted">Uploads to {status.email}&apos;s Recap Cloud account with the transcript from this computer.</p>
        </>
      )}
    </div>
  );
}
