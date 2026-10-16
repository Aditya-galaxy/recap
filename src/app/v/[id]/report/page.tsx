import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ReportEditor } from "@/components/Report";
import { currentUser } from "@/lib/auth";
import { isOwner, readMeta } from "@/lib/store";

export const metadata: Metadata = { title: "Bug report · Recap", robots: { index: false, follow: false } };

export default function ReportPage({ params }: PageProps<"/v/[id]/report">) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-3xl px-4 py-8 text-muted">loading…</div>}>
      <ReportLoader params={params} />
    </Suspense>
  );
}

async function ReportLoader({ params }: { params: PageProps<"/v/[id]/report">["params"] }) {
  await connection();
  const { id } = await params;
  const meta = await readMeta(id);
  // Only the owner edits a report.
  if (!meta || !isOwner(meta, await currentUser())) notFound();
  return (
    <div className="px-4 py-8">
      <ReportEditor videoId={id} videoTitle={meta.title} />
    </div>
  );
}
