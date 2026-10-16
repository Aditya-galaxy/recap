import Link from "next/link";
import { connection } from "next/server";
import FeedbackButton from "@/components/FeedbackButton";
import { config } from "@/lib/config";

/** Reads runtime config (local / cloud / self-hosted), so it renders per request rather than at build time. */
export default async function Footer() {
  await connection();
  const version = process.env.RECAP_VERSION ?? process.env.npm_package_version ?? "";
  const feedback = config.feedbackUrl && (
    <FeedbackButton url={config.feedbackUrl} where={config.localToken ? "desktop" : "web"} version={version} />
  );
  // The desktop app: people only need a way to reach us (and the version, for bug reports).
  if (config.localToken) {
    return (
      <footer className="mx-auto flex w-full max-w-6xl justify-between px-4 py-6 text-[11px] text-muted">
        <span className="flex gap-3">
          {feedback}
          <a className="underline" href="https://github.com/sponsors/Aditya-galaxy" target="_blank" rel="noreferrer">
            support Recap
          </a>
        </span>
        {version && <span>Recap {version}</span>}
      </footer>
    );
  }
  return (
    <footer className="mx-auto w-full max-w-6xl px-4 py-6 text-[11px] text-muted">
      {config.cloud ? "recap cloud" : "self-hosted"} ·{" "}
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
      {feedback && (
        <>
          {" · "}
          {feedback}
        </>
      )}
    </footer>
  );
}
