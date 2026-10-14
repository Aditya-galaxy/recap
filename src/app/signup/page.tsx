import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import AuthForm from "@/components/AuthForm";
import { isLocalMode, currentUser, signupOpen, userCount } from "@/lib/auth";
import { config } from "@/lib/config";

export const metadata = { title: "Sign up · Recap" };

export default function SignupPage() {
  return (
    <Suspense>
      <Gate />
    </Suspense>
  );
}

async function Gate() {
  await connection();
  if (isLocalMode()) redirect("/");
  if (await currentUser()) redirect("/");
  if (!signupOpen()) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16">
        <h1 className="text-lg font-medium">sign-ups are closed</h1>
        <p className="mt-2 text-[13px] text-muted">Ask the admin of this Recap server for an account.</p>
      </div>
    );
  }
  const first = userCount() === 0;
  return <AuthForm mode="signup" firstUser={first} needsSetupCode={first && !!config.setupCode} legal={config.cloud && !first} />;
}
