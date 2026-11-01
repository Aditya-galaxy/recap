"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const EXTENSIONS = ["mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "flv", "mpg", "mpeg", "ts", "mts", "m2ts", "3gp", "ogv", "gif"];
const isVideo = (f: File) => f.type.startsWith("video/") || EXTENSIONS.includes(f.name.split(".").pop()?.toLowerCase() ?? "");
const titleOf = (name: string) => name.replace(/\.[^.]+$/, "").trim().slice(0, 200) || name;

type Item = { key: number; name: string; progress: number; state: "waiting" | "sending" | "done" | "failed"; error?: string };

/**
 * Bring in videos made elsewhere: the import button, or drop files anywhere in the window. They go through the
 * same path as a recording, so they get a transcript, clean-up, trim, guides and bug reports.
 */
export default function Import({ local }: { local: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const current = useRef<{ key: number; xhr: XMLHttpRequest } | null>(null);
  const queue = useRef<{ key: number; file: File; single: boolean }[]>([]);
  const nextKey = useRef(1);
  const depth = useRef(0);

  const patch = (key: number, change: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...change } : i)));

  // One at a time: each file is streamed to the engine, and the work behind it is queued anyway.
  const pump = useRef<() => void>(() => {});
  useEffect(() => {
    pump.current = () => {
      if (current.current) return;
      const job = queue.current.shift();
      if (!job) return;
      const { key, file, single } = job;
      const xhr = new XMLHttpRequest();
      current.current = { key, xhr };
      const finished = (change: Partial<Item> | null) => {
        current.current = null;
        if (change) patch(key, change);
        else setItems((list) => list.filter((i) => i.key !== key));
        pump.current();
      };
      xhr.open("POST", "/api/videos");
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.setRequestHeader("x-title", encodeURIComponent(titleOf(file.name)));
      xhr.upload.onprogress = (e) => e.lengthComputable && patch(key, { progress: e.loaded / e.total });
      xhr.onload = () => {
        if (xhr.status !== 201) {
          let error = `couldn't import (HTTP ${xhr.status})`;
          try {
            error = JSON.parse(xhr.responseText).error ?? error;
          } catch {
            /* not JSON */
          }
          return finished({ state: "failed", error });
        }
        finished({ state: "done", progress: 1 });
        // A single file opens straight away, like a finished recording; a batch shows up in the library.
        if (single) router.push(`/v/${JSON.parse(xhr.responseText).id}`);
        else router.refresh();
      };
      xhr.onerror = () => finished({ state: "failed", error: "couldn't reach Recap's engine" });
      xhr.onabort = () => finished(null);
      patch(key, { state: "sending" });
      xhr.send(file);
    };
  }, [router]);

  const add = useCallback((files: File[]) => {
    const single = files.length === 1;
    const added = files.map((file): Item => {
      const key = nextKey.current++;
      const ok = isVideo(file) && file.size > 0;
      if (ok) queue.current.push({ key, file, single });
      return { key, name: file.name, progress: 0, state: ok ? "waiting" : "failed", error: ok ? undefined : "isn't a video file" };
    });
    setItems((list) => [...list.filter((i) => i.state !== "done"), ...added]);
    pump.current();
  }, []);

  const removeWaiting = (key: number) => {
    queue.current = queue.current.filter((q) => q.key !== key);
    setItems((list) => list.filter((x) => x.key !== key));
  };

  // Finished imports clear themselves shortly after; failures stay until dismissed.
  useEffect(() => {
    if (items.length === 0 || items.some((i) => i.state !== "done")) return;
    const t = setTimeout(() => setItems([]), 2500);
    return () => clearTimeout(t);
  }, [items]);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      if (--depth.current <= 0) {
        depth.current = 0;
        setOver(false);
      }
    };
    // Without this, dropping a file makes the window navigate away to it.
    const dragover = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      add([...(e.dataTransfer?.files ?? [])]);
    };
    const pick = () => input.current?.click();
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", dragover);
    window.addEventListener("drop", drop);
    window.addEventListener("recap:import", pick);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", dragover);
      window.removeEventListener("drop", drop);
      window.removeEventListener("recap:import", pick);
    };
  }, [add]);

  return (
    <>
      <button className="btn-ghost" onClick={() => input.current?.click()}>import</button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Choose video files to import"
        accept={`video/*,${EXTENSIONS.map((e) => `.${e}`).join(",")}`}
        onChange={(e) => {
          add([...(e.target.files ?? [])]);
          e.target.value = ""; // choosing the same file again should still work
        }}
      />
      {/* In a portal: the header's blur would otherwise make it the frame for anything "fixed" inside it. */}
      {(over || items.length > 0) && createPortal(
        <>
          {over && (
            <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-black/70 p-6 text-center text-white">
              <div>
                <p className="text-xl font-semibold tracking-tight">Drop to import</p>
                {local && <p className="mt-2 text-[13px] text-white/70">It stays on this computer. Nothing is uploaded.</p>}
              </div>
            </div>
          )}
          {items.length > 0 && (
            <div role="status" className="card fixed bottom-4 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] space-y-3 p-3 text-[12px]">
              {items.map((i) => (
                <div key={i.key}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate" title={i.name}>{i.name}</p>
                    {i.state === "sending" && (
                      <button className="shrink-0 text-muted underline" onClick={() => current.current?.key === i.key && current.current.xhr.abort()}>cancel</button>
                    )}
                    {i.state === "waiting" && (
                      <button className="shrink-0 text-muted underline" onClick={() => removeWaiting(i.key)}>remove</button>
                    )}
                    {i.state === "failed" && (
                      <button className="shrink-0 text-muted underline" onClick={() => setItems((list) => list.filter((x) => x.key !== i.key))}>dismiss</button>
                    )}
                  </div>
                  {i.state === "failed" ? (
                    <p className="mt-1 text-muted">{i.error}</p>
                  ) : (
                    <>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-current" style={{ width: `${Math.round(i.progress * 100)}%` }} /></div>
                      <p className="mt-1 text-muted">{i.state === "done" ? "imported, processing…" : i.state === "waiting" ? "waiting…" : `importing ${Math.round(i.progress * 100)}%`}</p>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </>,
        document.body,
      )}
    </>
  );
}
