"use client";

import { useSyncExternalStore } from "react";
import RecordButton from "@/components/RecordButton";

const noop = () => () => {};
const isMac = () => /Mac/i.test(navigator.platform || navigator.userAgent);

/** First thing a new person sees: what Recap does, in three steps, and how to start. */
export default function EmptyLibrary() {
  const mac = useSyncExternalStore(noop, isMac, () => false);
  const shortcut = mac ? "⌥⌘R" : "Ctrl+Alt+R";
  const steps = [
    ["Record", `Click record, or press ${shortcut} from any app. Your screen and a small camera bubble are recorded together.`],
    ["Get the transcript", "When you stop, Recap writes the transcript on this computer. Nothing is uploaded."],
    ["Clean up and share", "Cut the ums and long pauses in one click, then share or export the video."],
  ];
  return (
    <div className="card px-6 py-14 sm:px-12">
      <h2 className="text-xl font-semibold tracking-tight">Welcome to Recap</h2>
      <p className="mt-2 text-[14px] text-muted">Make your first recording in under a minute.</p>
      <ol className="mt-8 grid gap-6 sm:grid-cols-3">
        {steps.map(([title, body], i) => (
          <li key={title}>
            <p className="label">{String(i + 1).padStart(2, "0")}</p>
            <p className="mt-2 font-medium">{title}</p>
            <p className="mt-1 text-[13px] text-muted">{body}</p>
          </li>
        ))}
      </ol>
      <div className="mt-10">
        <RecordButton />
      </div>
    </div>
  );
}
