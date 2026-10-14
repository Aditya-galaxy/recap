"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

type Desktop = { record?: () => void };
const desktop = () => (window as unknown as { recapDesktop?: Desktop }).recapDesktop;
const noop = () => () => {};

/** In the desktop app, recording uses the native recorder (floating bubble, hotkey); on the web, /record. */
export default function RecordButton() {
  // Server render and first client render agree (no bridge); the bridge is picked up after hydration.
  const hasBridge = useSyncExternalStore(noop, () => !!desktop()?.record, () => false);
  const label = (
    <>
      <span className="h-1.5 w-1.5 rounded-full bg-current" /> record
    </>
  );
  return hasBridge ? (
    <button className="btn-primary" onClick={() => desktop()?.record?.()}>{label}</button>
  ) : (
    <Link href="/record" className="btn-primary">{label}</Link>
  );
}
