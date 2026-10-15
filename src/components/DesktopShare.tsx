"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// Desktop app only: share a video through the operating system (share sheet, clipboard, drag and drop).
// The library window's preload exposes window.recapDesktop; in a normal browser this renders nothing.

interface Bridge {
  platform: string;
  share: (action: "menu" | "copy" | "folder", video: Video) => Promise<string>;
  dragVideo: (video: Video) => void;
}
interface Video {
  id: string;
  version: "original" | "clean";
  title: string;
}

// Older builds of the desktop app don't have sharing; don't show a button that can't work.
function bridge(): Bridge | null {
  const b = (window as unknown as { recapDesktop?: Partial<Bridge> }).recapDesktop;
  return b?.share && b.dragVideo ? (b as Bridge) : null;
}
const noSubscribe = () => () => {};

export default function DesktopShare({ video }: { video: Video }) {
  const api = useSyncExternalStore(noSubscribe, bridge, () => null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!api) return null;
  const mac = api.platform === "darwin";
  const folder = mac ? "Finder" : api.platform === "win32" ? "File Explorer" : "folder";

  async function run(action: "menu" | "copy" | "folder") {
    setNote("");
    try {
      await api!.share(action, video);
      if (action === "copy") setNote("Copied. Paste it into Slack, Teams, an email or a chat.");
      if (action !== "copy") setOpen(false);
    } catch (err) {
      setNote(String((err as Error).message).replace(/^Error invoking remote method 'share': (Error: )?/, ""));
    }
  }

  const item = "block w-full rounded-sm px-3 py-2 text-left hover:bg-surface-2";
  return (
    <div className="relative" ref={box}>
      <button className="btn-primary" onClick={() => (setOpen((o) => !o), setNote(""))} aria-expanded={open}>
        share
      </button>
      {open && (
        <div className="card absolute right-0 z-20 mt-2 w-72 space-y-1 p-2 text-[13px] shadow-xl">
          <div
            draggable
            onDragStart={(e) => {
              e.preventDefault();
              api.dragVideo(video);
            }}
            className="mb-1 cursor-grab rounded-sm border border-dashed border-border-strong px-3 py-3 text-center active:cursor-grabbing"
            title="Drag this into another app"
          >
            <p>drag into Slack, Teams or an email</p>
            <p className="text-[11px] text-muted">{video.version === "clean" ? "cleaned version" : "original version"} · mp4</p>
          </div>
          {mac && (
            <button className={item} onClick={() => run("menu")}>
              share… <span className="text-muted">Mail, Messages, AirDrop</span>
            </button>
          )}
          {api.platform !== "linux" && (
            <button className={item} onClick={() => run("copy")}>
              copy video
            </button>
          )}
          <button className={item} onClick={() => run("folder")}>
            show in {folder}
          </button>
          {note && <p className="px-3 pb-1 pt-2 text-[11px] text-muted">{note}</p>}
        </div>
      )}
    </div>
  );
}
