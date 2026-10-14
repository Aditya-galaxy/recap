import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Contact, LegalPage } from "@/components/Legal";
import { config } from "@/lib/config";

export const metadata = { title: "Terms · Recap" };

export default function TermsPage() {
  return (
    <Suspense>
      <Terms />
    </Suspense>
  );
}

// Rendered per request: CLOUD_MODE is a runtime setting, not a build-time one.
async function Terms() {
  await connection();
  if (!config.cloud) notFound();
  return (
    <LegalPage title="Terms of use">
      <p>
        These terms cover Recap Cloud, the hosted service at this address. The Recap desktop app and the open-source code are
        MIT-licensed and don&apos;t need an account.
      </p>
      <h2>your account</h2>
      <ul>
        <li>One person per account. Keep your password to yourself; you&apos;re responsible for what happens under your account.</li>
        <li>You need to be old enough to agree to these terms where you live, and at least 13.</li>
      </ul>
      <h2>your videos</h2>
      <ul>
        <li>You own what you record. You give us permission to store, process (transcribe, render cleaned versions) and serve it to the people you share it with. That&apos;s all we use it for.</li>
        <li>Unlisted videos can be watched by anyone who has the link. Private videos only by you.</li>
        <li>Only upload what you have the right to share, and nothing illegal, abusive, sexual involving minors, hateful, or meant to deceive or harm people.</li>
        <li>Anyone can report a video. We may take down videos or close accounts that break these rules; the owner gets an email when that happens.</li>
      </ul>
      <h2>plans</h2>
      <ul>
        <li>The first {config.founderLimit} confirmed accounts get the founding plan: free for life, with a fair-use storage limit ({Math.round(config.quotaBytes.founder / 1024 ** 3)} GB). We&apos;ll never charge a founding account without its explicit opt-in.</li>
        <li>Other free accounts have a smaller limit ({Math.round(config.quotaBytes.standard / 1024 ** 3)} GB). Paid plans, if and when they launch, will be announced with their price before anyone is charged.</li>
      </ul>
      <h2>the service</h2>
      <ul>
        <li>We work hard to keep it up and your videos safe, but it&apos;s provided as is, without warranties. Keep your own copy of anything you can&apos;t afford to lose (every video has a download button).</li>
        <li>If we ever shut the service down, we&apos;ll email you at least 30 days ahead so you can download everything.</li>
        <li>You can delete your account at any time from settings; that deletes your videos too.</li>
      </ul>
      <h2>changes</h2>
      <p>If these terms change in a way that matters, we&apos;ll email you before the change takes effect.</p>
      <p>Questions: <Contact />.</p>
    </LegalPage>
  );
}
