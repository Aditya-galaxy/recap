import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import Watch from "@/components/Watch";
import { currentUser, isLocalMode } from "@/lib/auth";
import { fmtTime } from "@/lib/format";
import { canView, isOwner, readMeta, readTranscript } from "@/lib/store";
import { baseUrl } from "@/lib/url";

export async function generateMetadata({ params }: PageProps<"/v/[id]">): Promise<Metadata> {
  await connection();
  const meta = await readMeta((await params).id);
  // Never index recordings, even unlisted ones.
  const robots = { index: false, follow: false };
  if (!meta || !canView(meta, await currentUser())) return { title: "Not found · Recap", robots };
  const base = await baseUrl();
  const description = meta.duration ? `${fmtTime(meta.duration)} video on Recap` : "Video on Recap";
  // Link previews (Slack, X, iMessage) only for unlisted videos; private ones reveal nothing.
  const thumb = `${base}/api/videos/${meta.id}/thumb`;
  const preview =
    meta.visibility === "unlisted" && meta.status === "ready"
      ? {
          openGraph: {
            type: "video.other" as const,
            title: meta.title,
            description,
            url: `${base}/v/${meta.id}`,
            images: [{ url: thumb, width: 640, height: meta.width && meta.height ? Math.round((640 * meta.height) / meta.width) : 360 }],
          },
          twitter: { card: "summary_large_image" as const, title: meta.title, description, images: [thumb] },
        }
      : {};
  return { title: `${meta.title} · Recap`, description, robots, ...preview };
}

export default function WatchPage({ params }: PageProps<"/v/[id]">) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-6 text-muted">loading…</div>}>
      <WatchLoader params={params} />
    </Suspense>
  );
}

async function WatchLoader({ params }: { params: PageProps<"/v/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  const user = await currentUser();
  const meta = await readMeta(id);
  // Private videos 404 for everyone but the owner, so their existence isn't revealed.
  if (!meta || !canView(meta, user)) notFound();
  const transcript = meta.status === "ready" ? await readTranscript(id) : null;
  return <Watch initialMeta={meta} initialTranscript={transcript} owner={isOwner(meta, user)} shareUrl={`${await baseUrl()}/v/${id}`} local={isLocalMode()} viewer={user ? { id: user.id, verified: user.emailVerified } : null} />;
}
