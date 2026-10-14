import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import Moderation from "@/components/Moderation";
import { currentUser, isLocalMode } from "@/lib/auth";
import { openReports, takenDown } from "@/lib/moderation";

export const metadata = { title: "Reports · Recap", robots: { index: false } };

export default function AdminPage() {
  return (
    <Suspense>
      <Loader />
    </Suspense>
  );
}

async function Loader() {
  await connection();
  if (isLocalMode()) notFound();
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin");
  if (!user.isAdmin) notFound();
  return <Moderation initial={{ open: openReports(), takenDown: takenDown() }} />;
}
