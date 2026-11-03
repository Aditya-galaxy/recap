import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { Suspense } from "react";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";
import VerifyBanner from "@/components/VerifyBanner";
import "./globals.css";

// Inter, bundled with the app (no network at build or run time). One variable file covers every weight and,
// through optical sizing, a display cut for headings.
const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Recap",
  description: "Record your screen and camera, share a link, and let AI clean up the ums.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans text-[14px]">
        <header className="sticky top-0 z-10 border-b border-border bg-bg/85 backdrop-blur">
          <div className="mx-auto flex h-13 max-w-6xl items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.02em]">
              <span aria-hidden className="grid h-5 w-5 place-items-center rounded-[6px] bg-accent">
                <span className="h-2 w-2 rounded-full bg-accent-text" />
              </span>
              Recap
            </Link>
            <Suspense fallback={<nav className="h-8" />}>
              <Nav />
            </Suspense>
          </div>
        </header>
        <Suspense>
          <VerifyBanner />
        </Suspense>
        <main className="flex-1">{children}</main>
        <Suspense>
          <Footer />
        </Suspense>
      </body>
    </html>
  );
}
