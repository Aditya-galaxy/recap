import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { consumeEmailToken, markVerified } from "@/lib/auth";
import { config } from "@/lib/config";

export const metadata = { title: "Confirm email · Recap", robots: { index: false } };

export default function VerifyPage({ searchParams }: PageProps<"/verify">) {
  return (
    <Suspense>
      <Verify searchParams={searchParams} />
    </Suspense>
  );
}

async function Verify({ searchParams }: { searchParams: PageProps<"/verify">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const token = String(Array.isArray(sp.token) ? sp.token[0] : sp.token ?? "");
  const userId = token ? consumeEmailToken(token, "verify") : null;
  const user = userId ? markVerified(userId) : null;

  return (
    <div className="mx-auto max-w-md px-4 py-16 text-[13px]">
      {user ? (
        <>
          <h1 className="text-lg font-medium">email confirmed ✓</h1>
          {user.founderNumber ? (
            <div className="card mt-6 p-5">
              <p className="label">founding member</p>
              <p className="mt-2 text-2xl font-light">#{user.founderNumber} of {config.founderLimit}</p>
              <p className="mt-2 text-muted">Recap Cloud is free for you for life, with fair-use limits. Thank you for being early.</p>
            </div>
          ) : config.cloud ? (
            <p className="mt-3 text-muted">The founding spots are gone, but your account is ready.</p>
          ) : null}
          <Link href="/" className="btn-primary mt-6">go to your library</Link>
        </>
      ) : (
        <>
          <h1 className="text-lg font-medium">this link doesn&apos;t work</h1>
          <p className="mt-3 text-muted">It may have expired or already been used. Sign in and request a new confirmation email.</p>
          <Link href="/login" className="btn-ghost mt-6">sign in</Link>
        </>
      )}
    </div>
  );
}
