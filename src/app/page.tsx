import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { fmtDate, fmtTime } from "@/lib/format";
import { listVideos } from "@/lib/store";

export default function Library() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-10 text-muted">loading…</div>}>
      <VideoGrid />
    </Suspense>
  );
}

async function VideoGrid() {
  await connection(); // the library lives on disk and changes on every upload
  const videos = await listVideos();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6 flex items-baseline justify-between gap-4 border-b border-border pb-3">
        <h1 className="text-lg font-medium">
          videos <span className="text-muted">[{videos.length}]</span>
        </h1>
        <span className="label">sorted by newest</span>
      </div>

      {videos.length === 0 ? (
        <div className="card px-6 py-16">
          <pre className="text-[13px] leading-6 text-muted">
{`$ recap ls
  no recordings yet

$ recap record --screen --cam`}
          </pre>
          <p className="mt-4 max-w-md text-[13px] text-muted">
            Screen + camera bubble → share link with transcript and captions → cut the ums and dead air in one pass.
          </p>
          <Link href="/record" className="btn-primary mt-6">start recording</Link>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((v) => (
            <li key={v.id}>
              <Link href={`/v/${v.id}`} className="card group block overflow-hidden transition-colors hover:border-border-strong">
                <div className="relative aspect-video border-b border-border bg-surface-2">
                  {v.status === "ready" || v.duration ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/videos/${v.id}/thumb`} alt="" className="h-full w-full object-cover grayscale transition group-hover:grayscale-0" />
                  ) : null}
                  {v.status !== "ready" && (
                    <span className="absolute left-2 top-2 rounded-sm bg-black px-1.5 py-0.5 text-[11px] text-white">
                      {v.status === "error" ? "failed" : (v.stage ?? "processing").toLowerCase() + "…"}
                    </span>
                  )}
                  {v.clean.status === "ready" && (
                    <span className="absolute bottom-2 left-2 rounded-sm bg-white px-1.5 py-0.5 text-[11px] text-black">cleaned</span>
                  )}
                  {v.duration ? (
                    <span className="absolute bottom-2 right-2 rounded-sm bg-black px-1.5 py-0.5 text-[11px] text-white">
                      {fmtTime(v.duration)}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-baseline justify-between gap-3 px-3 py-2.5">
                  <p className="truncate text-[13px] group-hover:underline">{v.title}</p>
                  <p className="shrink-0 text-[11px] text-muted">{fmtDate(v.createdAt)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
