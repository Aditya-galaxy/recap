import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { fmtDate, fmtTime } from "@/lib/format";
import { currentUser, userCount } from "@/lib/auth";
import { listVideos } from "@/lib/store";

const PAGE = 48;

export default function Library({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-10 text-muted">loading…</div>}>
      <VideoGrid searchParams={searchParams} />
    </Suspense>
  );
}

async function VideoGrid({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  await connection(); // the library changes on every upload
  const user = await currentUser();
  if (!user) return <Landing fresh={userCount() === 0} />;
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q ?? "").slice(0, 100);
  const page = Math.max(1, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1);
  // Paged so a library with thousands of recordings stays a small, fast page.
  const { videos, total } = await listVideos(user.id, { q, limit: PAGE, offset: (page - 1) * PAGE });
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const href = (p: number) => `/?${new URLSearchParams({ ...(q ? { q } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6 flex items-baseline justify-between gap-4 border-b border-border pb-3">
        <h1 className="text-lg font-medium">
          videos <span className="text-muted">[{total}]</span>
        </h1>
        <form action="/" className="flex items-center gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="search titles"
            aria-label="Search videos by title"
            className="w-44 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] outline-none focus:border-border-strong sm:w-60"
          />
        </form>
      </div>

      {videos.length === 0 && q ? (
        <p className="text-[13px] text-muted">No videos match “{q}”. <Link href="/" className="underline">Clear search</Link></p>
      ) : videos.length === 0 ? (
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
                    <img src={`/api/videos/${v.id}/thumb`} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover grayscale transition group-hover:grayscale-0" />
                  ) : null}
                  {v.status !== "ready" && (
                    <span className="absolute left-2 top-2 rounded-lg bg-black px-1.5 py-0.5 text-[11px] text-white">
                      {v.status === "error" ? "failed" : (v.stage ?? "processing").toLowerCase() + "…"}
                    </span>
                  )}
                  {v.clean.status === "ready" && (
                    <span className="absolute bottom-2 left-2 rounded-lg bg-white px-1.5 py-0.5 text-[11px] text-black">cleaned</span>
                  )}
                  {v.duration ? (
                    <span className="absolute bottom-2 right-2 rounded-lg bg-black px-1.5 py-0.5 text-[11px] text-white">
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

      {pages > 1 && (
        <nav className="mt-8 flex items-center justify-between text-[12px]" aria-label="Pages">
          {page > 1 ? <Link className="btn-ghost" href={href(page - 1)}>← newer</Link> : <span />}
          <span className="text-muted">page {page} of {pages}</span>
          {page < pages ? <Link className="btn-ghost" href={href(page + 1)}>older →</Link> : <span />}
        </nav>
      )}
    </div>
  );
}

function Landing({ fresh }: { fresh: boolean }) {
  const points = [
    ["record", "screen + camera bubble from the browser or the Mac, Windows and Linux apps"],
    ["share", "an unlisted link with captions and a transcript; viewers don't need an account"],
    ["clean up", "cut the ums and long pauses in one click, transcribed locally with whisper.cpp"],
    ["own it", "self-hosted, unlimited videos, nothing leaves your server"],
  ];
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <p className="label">self-hosted async video</p>
      <h1 className="mt-3 text-2xl font-medium leading-tight sm:text-3xl">
        Record it once. Share a link.
        <br />
        <span className="text-muted">Skip the meeting.</span>
      </h1>
      <ul className="mt-8 space-y-3 text-[13px]">
        {points.map(([k, v]) => (
          <li key={k} className="flex gap-4">
            <span className="w-20 shrink-0 text-muted">{k}</span>
            <span>{v}</span>
          </li>
        ))}
      </ul>
      <div className="mt-10 flex gap-2">
        {fresh ? (
          <Link href="/signup" className="btn-primary">set up this server</Link>
        ) : (
          <>
            <Link href="/login" className="btn-primary">sign in</Link>
            <Link href="/signup" className="btn-ghost">create account</Link>
          </>
        )}
      </div>
    </div>
  );
}
