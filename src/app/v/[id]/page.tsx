import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import Watch from "@/components/Watch";
import { readMeta, readTranscript } from "@/lib/store";

export async function generateMetadata({ params }: PageProps<"/v/[id]">) {
  await connection();
  const meta = await readMeta((await params).id);
  return { title: meta ? `${meta.title} · Recap` : "Not found · Recap" };
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
  const meta = await readMeta(id);
  if (!meta) notFound();
  const transcript = meta.status === "ready" ? await readTranscript(id) : null;
  return <Watch initialMeta={meta} initialTranscript={transcript} />;
}
