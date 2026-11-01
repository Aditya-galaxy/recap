// Downloads a pinned, checksum-verified static ffmpeg for this platform into desktop/bin.
// ffmpeg is GPL; it ships as a separate executable alongside Recap (see THIRD_PARTY.md).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Unmodified BtbN/FFmpeg-Builds archives (autobuild-2026-10-31-12-59), mirrored because upstream deletes dated
// builds after about two weeks. To re-pin: add the new archives to this prerelease, never mark it latest.
const MIRROR = "https://github.com/Aditya-galaxy/recap/releases/download/build-deps-ffmpeg";
const SOURCES = {
  "darwin-arm64": {
    url: "https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip",
    sha256: "c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924",
  },
  "linux-x64": {
    url: `${MIRROR}/ffmpeg-n8.1.3-27-g8dca1586f4-linux64-gpl-8.1.tar.xz`,
    sha256: "41e9c565594c390622cf968d82fa4135d9e9a11d06c1515644288cbc844e3380",
  },
  "win32-x64": {
    url: `${MIRROR}/ffmpeg-n8.1.3-27-g8dca1586f4-win64-gpl-8.1.zip`,
    sha256: "401dffcf14c301082e1fc03b0bc876b92ea676bfc521fc56e80a1537d137034f",
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
