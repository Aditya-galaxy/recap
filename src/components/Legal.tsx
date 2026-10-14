import { config } from "@/lib/config";

/** Shared frame for the Terms and Privacy pages. Plain language on purpose. */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-2xl space-y-5 px-4 py-10 text-[13px] leading-relaxed [&_h2]:label [&_h2]:pt-4 [&_li]:ml-4 [&_li]:list-disc [&_ul]:space-y-1">
      <header className="space-y-1">
        <h1 className="text-lg font-medium">{title}</h1>
        <p className="text-[11px] text-muted">last updated {config.legalUpdated}</p>
      </header>
      {children}
    </article>
  );
}

export function Contact() {
  return config.contactEmail ? (
    <a className="underline" href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a>
  ) : (
    <>the feedback link at the bottom of every page</>
  );
}
