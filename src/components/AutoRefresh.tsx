"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Keeps a page's server data current while something is still processing (imports show up as they finish). */
export default function AutoRefresh({ active, ms = 4000 }: { active: boolean; ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [active, ms, router]);
  return null;
}
