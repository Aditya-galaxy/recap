import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import Recorder from "@/components/Recorder";
import { currentUser } from "@/lib/auth";

export const metadata = { title: "New recording · Recap" };

export default function RecordPage() {
  return (
    <Suspense>
      <Gate />
    </Suspense>
  );
}

async function Gate() {
  await connection();
  if (!(await currentUser())) redirect("/login?next=/record");
  return <Recorder />;
}
