import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config";
import { db } from "./db";

/**
 * Desktop app: the library keeps each recording in its own folder (videos/<id>/video.mp4), which means
 * nothing to someone browsing their Videos folder. So every finished recording also appears there as
 * "<title> – <date>.mp4" (and "… (cleaned).mp4" once a clean cut exists). These are hard links: the same
 * file under a readable name, no extra disk space. Renaming or deleting in the app follows; a file the
 * person deletes or renames themselves is left alone, not recreated.
 */

type Entry = { id: string; version: "original" | "clean"; name: string; ino: number; gone?: boolean };

const dir = config.namedDir ?? "";
const manifestPath = () => path.join(config.dataDir, "named-files.json");
const source = (id: string, version: Entry["version"]) =>
  path.join(config.dataDir, "videos", id, version === "clean" ? "clean.mp4" : "video.mp4");

// Windows rejects these characters and names; macOS and Linux are fine with the result too.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
function safeName(title: string) {
  let s = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).replace(/[. ]+$/, "");
  if (!s || RESERVED.test(s)) s = "Recording";
  return s;
}

function stamp(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
}

async function inode(p: string) {
  try {
    return (await fs.stat(p)).ino;
  } catch {
    return null;
  }
}

async function readManifest(): Promise<Entry[]> {
  try {
    return JSON.parse(await fs.readFile(manifestPath(), "utf8"));
  } catch {
    return [];
  }
}

let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Bring the named files in line with the library. Cheap and debounced; safe to call after any change. */
export function syncNamedFiles() {
  if (!dir) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (running) {
      again = true;
      return;
    }
    running = sync()
      .catch((err) => console.error("[folder] sync failed", err))
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          syncNamedFiles();
        }
      });
  }, 400);
}

async function sync() {
  const rows = db.prepare("SELECT id, title, status, clean_status, created_at FROM videos").all() as {
    id: string; title: string; status: string; clean_status: string; created_at: string;
  }[];
  const old = await readManifest();
  const oldByKey = new Map(old.map((e) => [`${e.id}/${e.version}`, e]));

  // What should exist, with names made unique (two recordings with the same title in the same minute).
  const wanted: Omit<Entry, "ino">[] = [];
  const taken = new Set<string>();
  for (const r of rows.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (r.status !== "ready") continue;
    const base = `${safeName(r.title)} – ${stamp(r.created_at)}`;
    for (const version of ["original", "clean"] as const) {
      if (version === "clean" && r.clean_status !== "ready") continue;
      const suffix = version === "clean" ? " (cleaned)" : "";
      let name = `${base}${suffix}.mp4`;
      if (taken.has(name.toLowerCase())) name = `${base} ${r.id}${suffix}.mp4`;
      taken.add(name.toLowerCase());
      wanted.push({ id: r.id, version, name });
    }
  }
  const wantedKeys = new Set(wanted.map((w) => `${w.id}/${w.version}`));

  // Remove our links that are no longer wanted or were renamed, but only if the file is still ours.
  for (const e of old) {
    const w = wanted.find((x) => x.id === e.id && x.version === e.version);
    if (wantedKeys.has(`${e.id}/${e.version}`) && w?.name === e.name) continue;
    const p = path.join(dir, e.name);
    if ((await inode(p)) === e.ino) await fs.rm(p, { force: true, maxRetries: 3 }).catch(() => {});
  }

  const next: Entry[] = [];
  for (const w of wanted) {
    const src = source(w.id, w.version);
    const srcIno = await inode(src);
    if (srcIno === null) continue;
    const p = path.join(dir, w.name);
    const prev = oldByKey.get(`${w.id}/${w.version}`);
    const sameName = prev?.name === w.name;
    const here = await inode(p);
    if (here === srcIno) {
      next.push({ ...w, ino: srcIno });
      continue;
    }
    // Deleted by the person: respect that (until the title changes and it gets a new name).
    if (sameName && (prev?.gone || here === null)) {
      next.push({ ...w, ino: prev!.ino, gone: true });
      continue;
    }
    // Our old link to a file that has since been re-rendered (a new clean cut): replace it.
    if (here !== null && sameName && here === prev?.ino) await fs.rm(p, { force: true, maxRetries: 3 }).catch(() => {});
    else if (here !== null) continue; // someone else's file with this name: leave it alone
    try {
      await fs.link(src, p);
      next.push({ ...w, ino: srcIno });
    } catch (err) {
      // A drive without hard links (FAT/exFAT) or a file in use: skip it rather than double the disk use.
      console.warn("[folder] couldn't add", w.name, (err as NodeJS.ErrnoException).code ?? err);
    }
  }

  await fs.writeFile(manifestPath() + ".tmp", JSON.stringify(next));
  await fs.rename(manifestPath() + ".tmp", manifestPath());
}
