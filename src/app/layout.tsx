import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";
import VerifyBanner from "@/components/VerifyBanner";
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
      <body className="min-h-full flex flex-col font-sans text-[14px]">
        <header className="sticky top-0 z-10 border-b border-border bg-bg/85 backdrop-blur">
          <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4">
            <Link href="/" className="flex items-center text-[16px] font-semibold tracking-tight">
              recap
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
