import Link from "next/link";
import { connection } from "next/server";
import FeedbackButton from "@/components/FeedbackButton";
import { config } from "@/lib/config";

/** Reads runtime config (local / cloud / self-hosted), so it renders per request rather than at build time. */
export default async function Footer() {
  await connection();
  return (
    <footer className="mx-auto w-full max-w-6xl px-4 py-6 text-[11px] text-muted">
      {config.localToken ? "local" : config.cloud ? "recap cloud" : "self-hosted"} · whisper.cpp + ffmpeg ·{" "}
      <a className="underline" href="https://github.com/Aditya-galaxy/recap">
        source
      </a>
      {config.cloud && (
        <>
          {" · "}
          <Link className="underline" href="/terms">
            terms
          </Link>
          {" · "}
          <Link className="underline" href="/privacy">
            privacy
          </Link>
        </>
      )}
      {config.feedbackUrl && (
        <>
          {" · "}
          <FeedbackButton url={config.feedbackUrl} where={config.localToken ? "desktop" : "web"} version={process.env.RECAP_VERSION ?? process.env.npm_package_version ?? ""} />
        </>
      )}
    </footer>
  );
}
