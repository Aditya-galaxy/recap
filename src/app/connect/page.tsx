import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import ConnectForm from "@/components/ConnectForm";
import { currentUser, isLocalMode } from "@/lib/auth";
import { normalizeUserCode, pendingRequest } from "@/lib/device";

export const metadata = { title: "Connect the app · Recap", robots: { index: false } };

export default function ConnectPage(props: PageProps<"/connect">) {
  return (
    <Suspense>
      <Connect {...props} />
    </Suspense>
  );
}

async function Connect({ searchParams }: PageProps<"/connect">) {
  await connection();
  if (isLocalMode()) notFound();
  const raw = (await searchParams).code;
  const code = normalizeUserCode(typeof raw === "string" ? raw : "") ?? "";
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/connect${code ? `?code=${code}` : ""}`)}`);
  const req = code ? pendingRequest(code) : null;
  return <ConnectForm initialCode={code} client={req?.client ?? null} email={user.email} verified={user.emailVerified} />;
}
