import { connection } from "next/server";
import { currentUser } from "@/lib/auth";
import ResendButton from "./ResendButton";

/** Shown to signed-in users who haven't confirmed their email (Recap Cloud double opt-in). */
export default async function VerifyBanner() {
  await connection();
  const user = await currentUser();
  if (!user || user.emailVerified) return null;
  return (
    <div className="border-b border-border bg-surface-2">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-[12px]">
        <span>
          Confirm your email to start recording. We sent a link to <span className="font-medium">{user.email}</span>.
        </span>
        <ResendButton />
      </div>
    </div>
  );
}
