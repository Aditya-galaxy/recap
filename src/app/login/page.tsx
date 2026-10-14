import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import AuthForm from "@/components/AuthForm";
import { isLocalMode, currentUser, userCount } from "@/lib/auth";

export const metadata = { title: "Sign in · Recap" };

export default function LoginPage() {
  return (
    <Suspense>
      <Gate />
    </Suspense>
  );
}

async function Gate() {
  await connection();
  if (isLocalMode()) redirect("/");
  if (userCount() === 0) redirect("/signup");
  if (await currentUser()) redirect("/");
  return <AuthForm mode="login" />;
}
