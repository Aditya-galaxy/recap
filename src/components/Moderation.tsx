"use client";

import Link from "next/link";
import { useState } from "react";
import { fmtDate } from "@/lib/format";
import type { ReportGroup } from "@/lib/moderation";

type Data = { open: ReportGroup[]; takenDown: { videoId: string; title: string; owner: string }[] };
type Action = "takedown" | "restore" | "dismiss";

/** Admin review queue for reported videos. */
export default function Moderation({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function act(videoId: string, action: Action) {
    if (action === "takedown" && !confirm("Take this video down? Only its owner will still be able to open it.")) return;
    setBusy(videoId);
    setError("");
    const r = await fetch("/api/admin/reports", { method: "POST", body: JSON.stringify({ videoId, action }) });
    setBusy("");
    if (r.ok) setData(await r.json());
    else setError((await r.json().catch(() => ({}))).error ?? "Something went wrong.");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-8">
      <section className="space-y-3">
        <h1 className="label">open reports</h1>
        {error && <p className="text-[12px] text-muted">{error}</p>}
        {data.open.length === 0 && <p className="text-[13px] text-muted">Nothing to review.</p>}
        {data.open.map((g) => (
          <div key={g.videoId} className="card space-y-3 p-4 text-[13px]">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link href={`/v/${g.videoId}`} target="_blank" className="font-medium underline">
                {g.title}
              </Link>
              <span className="text-[11px] text-muted">
                {g.owner || "no owner"}
                {g.disabled ? " · taken down" : ""}
              </span>
            </div>
            <ul className="space-y-1 text-[12px]">
              {g.reports.map((r, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="break-words">{r.reason}</span>
                  <span className="shrink-0 text-muted">{fmtDate(r.createdAt)}</span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button className="btn-danger" disabled={busy === g.videoId} onClick={() => act(g.videoId, "takedown")}>
                take down
              </button>
              <button className="btn-ghost" disabled={busy === g.videoId} onClick={() => act(g.videoId, "dismiss")}>
                dismiss
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="label">taken down</h2>
        {data.takenDown.length === 0 && <p className="text-[13px] text-muted">None.</p>}
        {data.takenDown.map((v) => (
          <div key={v.videoId} className="card flex flex-wrap items-center justify-between gap-3 p-3 text-[13px]">
            <span>
              <Link href={`/v/${v.videoId}`} target="_blank" className="underline">{v.title}</Link>
              <span className="ml-2 text-[11px] text-muted">{v.owner}</span>
            </span>
            <button className="btn-ghost" disabled={busy === v.videoId} onClick={() => act(v.videoId, "restore")}>
              restore
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
