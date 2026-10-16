import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { GuideEditor } from "@/components/Guide";
import { currentUser } from "@/lib/auth";
import { isOwner, readMeta } from "@/lib/store";

export const metadata: Metadata = { title: "Guide · Recap", robots: { index: false, follow: false } };

export default function GuidePage({ params }: PageProps<"/v/[id]/guide">) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-3xl px-4 py-8 text-muted">loading…</div>}>
      <GuideLoader params={params} />
    </Suspense>
  );
}

async function GuideLoader({ params }: { params: PageProps<"/v/[id]/guide">["params"] }) {
  await connection();
  const { id } = await params;
  const meta = await readMeta(id);
  // Only the owner edits a guide.
  if (!meta || !isOwner(meta, await currentUser())) notFound();
  return (
    <div className="px-4 py-8">
      <GuideEditor videoId={id} videoTitle={meta.title} />
    </div>
  );
}
