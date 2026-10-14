import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Contact, LegalPage } from "@/components/Legal";
import { config } from "@/lib/config";

export const metadata = { title: "Privacy · Recap" };

export default function PrivacyPage() {
  return (
    <Suspense>
      <Privacy />
    </Suspense>
  );
}

// Rendered per request: CLOUD_MODE is a runtime setting, not a build-time one.
async function Privacy() {
  await connection();
  if (!config.cloud) notFound();
  return (
    <LegalPage title="Privacy">
      <p>Short version: we keep what&apos;s needed to run the service, we don&apos;t sell or share it, and there are no ads or third-party trackers.</p>
      <h2>what we store</h2>
      <ul>
        <li><b>Account:</b> your email, name, a salted hash of your password (never the password itself), and your settings.</li>
        <li><b>Videos:</b> the recordings you upload, their transcripts, thumbnails and cleaned versions.</li>
        <li><b>Activity on shared videos:</b> comments, reactions, and how far each viewer watched. Signed-in viewers appear by name in the owner&apos;s insights; everyone else is an anonymous viewer, identified only by a random cookie.</li>
        <li><b>Security:</b> session cookies, and IP addresses held briefly in memory for rate limiting. The app doesn&apos;t save IP addresses; the hosting provider&apos;s request logs may keep them for a short time.</li>
      </ul>
      <h2>where it goes</h2>
      <ul>
        <li>Transcription runs on our own server with whisper.cpp. Your audio is not sent to any AI provider.</li>
        <li>Emails (confirmation, password reset, notifications you turned on) are sent through Resend, which sees your address and the message.</li>
        <li>The server and your files live with our hosting provider. Nobody else gets your data unless the law requires it.</li>
      </ul>
      <h2>cookies</h2>
      <p>Only the ones the service needs: your session, and an anonymous viewer id so reactions and views aren&apos;t double-counted. No analytics or advertising cookies.</p>
      <h2>your control</h2>
      <ul>
        <li>Download any video, make it private, or delete it whenever you like.</li>
        <li>Turn email notifications on or off in settings.</li>
        <li>Deleting your account removes your account, videos, transcripts and comments right away.</li>
        <li>To get a copy of your data or ask anything else: <Contact />.</li>
      </ul>
    </LegalPage>
  );
}
