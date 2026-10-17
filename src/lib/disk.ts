import "server-only";
import { promises as fs } from "node:fs";

/** What people see when the disk fills up, instead of ENOSPC or "database or disk is full". */
export const DISK_FULL = "Your disk is full. Free up some space, then try again.";

/** Room to leave free on top of an upload: processing writes a copy about the same size, plus thumbnails. */
const HEADROOM = 512 * 1024 * 1024;

export function isDiskFull(err: unknown) {
  const e = err as { code?: string; errcode?: number; message?: string } | null;
  return e?.code === "ENOSPC" || e?.errcode === 13 || /ENOSPC|No space left on device|disk is full/i.test(e?.message ?? "");
}

/** Free bytes on the drive holding `dir`, or null if the OS won't say. */
export async function freeBytes(dir: string) {
  try {
    const s = await fs.statfs(dir);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

/** True when there's clearly not enough room to store and process a file of `size` bytes. */
export async function tooLittleSpace(dir: string, size: number) {
  const free = await freeBytes(dir);
  return free !== null && free < size * 2 + HEADROOM;
}
