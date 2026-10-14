import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import FeedbackButton from "@/components/FeedbackButton";
import Nav from "@/components/Nav";
import { config } from "@/lib/config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Recap",
  description: "Record your screen and camera, share a link, and let AI clean up the ums.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="grid-bg min-h-full flex flex-col font-mono text-[14px]">
        <header className="sticky top-0 z-10 border-b border-border bg-bg/85 backdrop-blur">
          <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4">
            <Link href="/" className="flex items-center text-[14px] font-medium">
              <span className="text-muted">~/</span>recap<span className="cursor-blink ml-0.5 inline-block h-3.5 w-[7px] bg-text" />
            </Link>
            <Suspense fallback={<nav className="h-8" />}>
              <Nav />
            </Suspense>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="mx-auto w-full max-w-6xl px-4 py-6 text-[11px] text-muted">
          {config.localToken ? "local" : "self-hosted"} · whisper.cpp + ffmpeg · <a className="underline" href="https://github.com/Aditya-galaxy/recap">source</a>
          {config.feedbackUrl && (
            <>
              {" · "}
              <FeedbackButton url={config.feedbackUrl} where={config.localToken ? "desktop" : "web"} version={process.env.RECAP_VERSION ?? process.env.npm_package_version ?? ""} />
            </>
          )}
        </footer>
      </body>
    </html>
  );
}
