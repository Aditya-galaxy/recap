import { Suspense } from "react";
import { ResetForm } from "@/components/PasswordForms";

export const metadata = { title: "Choose a new password · Recap", robots: { index: false } };

export default function ResetPage({ searchParams }: PageProps<"/reset">) {
  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-lg font-medium">choose a new password</h1>
      <Suspense>
        <WithToken searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function WithToken({ searchParams }: { searchParams: PageProps<"/reset">["searchParams"] }) {
  const sp = await searchParams;
  return <ResetForm token={String(Array.isArray(sp.token) ? sp.token[0] : sp.token ?? "")} />;
}
