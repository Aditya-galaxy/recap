"use client";

import { useState } from "react";

export default function ResendButton() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  async function resend() {
    setState("sending");
    const r = await fetch("/api/auth/resend-verification", { method: "POST" }).catch(() => null);
    setState(r?.ok ? "sent" : "error");
  }
  return (
    <button className="btn-ghost" onClick={resend} disabled={state === "sending" || state === "sent"}>
      {state === "sent" ? "sent ✓" : state === "error" ? "try again later" : "resend email"}
    </button>
  );
}
