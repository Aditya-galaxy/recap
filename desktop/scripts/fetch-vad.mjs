// Downloads the Silero voice-activity-detection model whisper.cpp uses to skip non-speech audio
// (background noise, music, silence), so it doesn't invent words there. ~0.9 MB, checksum-pinned.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "ggml-silero-v5.1.2.bin";
const URL = `https://huggingface.co/ggml-org/whisper-vad/resolve/main/${NAME}`;
const SHA256 = "29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf";
const dest = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", NAME);
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

if (existsSync(dest) && sha(readFileSync(dest)) === SHA256) {
  console.log(`${NAME} already present`);
} else {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== SHA256) throw new Error(`${NAME}: checksum mismatch`);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  console.log(`${NAME} → ${dest}`);
}
