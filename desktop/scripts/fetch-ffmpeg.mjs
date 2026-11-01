// Downloads a pinned, checksum-verified static ffmpeg for this platform into desktop/bin.
// ffmpeg is GPL; it ships as a separate executable alongside Recap (see THIRD_PARTY.md).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BTBN = "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-13-13-05";
const SOURCES = {
  "darwin-arm64": {
    url: "https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip",
    sha256: "c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924",
  },
  "linux-x64": {
    url: `${BTBN}/ffmpeg-n8.1.3-18-g46d899d7a0-linux64-gpl-8.1.tar.xz`,
    sha256: "b3506f47a71a2f8cff8c0775112bf02a8a49035e3994232aa5f218058328e0e7",
  },
  "win32-x64": {
    url: `${BTBN}/ffmpeg-n8.1.3-18-g46d899d7a0-win64-gpl-8.1.zip`,
    sha256: "f328d719f8805ea9ab76b8e99dc4a52537e92c6d6f5f8302f297988b9a928bb6",
  },
};

const key = `${process.platform}-${process.arch}`;
const src = SOURCES[key];
if (!src) throw new Error(`no pinned ffmpeg for ${key}`);
const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
const binDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin");

console.log(`fetching ffmpeg for ${key}…`);
const res = await fetch(src.url);
if (!res.ok) throw new Error(`download failed: HTTP ${res.status} ${src.url}`);
const buf = Buffer.from(await res.arrayBuffer());
const got = createHash("sha256").update(buf).digest("hex");
if (got !== src.sha256) throw new Error(`checksum mismatch for ${src.url}\n  expected ${src.sha256}\n  got      ${got}`);

const tmp = mkdtempSync(path.join(os.tmpdir(), "recap-ffmpeg-"));
const archive = path.join(tmp, path.basename(new URL(src.url).pathname));
writeFileSync(archive, buf);
// bsdtar (macOS, Windows 10+) and GNU tar both handle these archives. On Windows, name the system
// bsdtar explicitly: under Git Bash, "tar" is GNU tar, which reads "C:" as a remote host and can't unzip.
const tar = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
execFileSync(tar, ["-xf", archive, "-C", tmp], { stdio: "inherit" });

const find = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const hit = find(p);
      if (hit) return hit;
    } else if (e.name === exe) return p;
  }
  return null;
};
const found = find(tmp);
if (!found) throw new Error("ffmpeg binary not found in archive");
mkdirSync(binDir, { recursive: true });
const dest = path.join(binDir, exe);
copyFileSync(found, dest);
chmodSync(dest, 0o755);
rmSync(tmp, { recursive: true, force: true });
console.log(`ffmpeg → ${dest} (${Math.round(statSync(dest).size / 1048576)} MB)`);
execFileSync(dest, ["-hide_banner", "-version"], { stdio: ["ignore", "inherit", "inherit"] });
