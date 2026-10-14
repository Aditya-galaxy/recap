// Builds a self-contained whisper-cli (whisper.cpp) for this platform into desktop/bin.
// Needs git, cmake and a C/C++ toolchain (Xcode CLT, build-essential, or MSVC).
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "v1.9.5";
const win = process.platform === "win32";
const binDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin");
const src = path.join(os.tmpdir(), `whisper.cpp-${VERSION}`);
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

if (!existsSync(path.join(src, "CMakeLists.txt"))) {
  rmSync(src, { recursive: true, force: true });
  run("git", ["clone", "--depth", "1", "--branch", VERSION, "https://github.com/ggml-org/whisper.cpp", src]);
}

const flags = [
  "-DCMAKE_BUILD_TYPE=Release",
  "-DBUILD_SHARED_LIBS=OFF", // one binary, no ggml/whisper shared libs to ship
  "-DWHISPER_BUILD_TESTS=OFF",
  "-DWHISPER_BUILD_SERVER=OFF",
  "-DGGML_NATIVE=OFF", // portable: don't tune for the build machine's CPU
];
if (process.platform === "darwin") flags.push("-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0"); // Metal stays on (GPU)
if (process.platform === "linux") flags.push("-DGGML_OPENMP=OFF"); // no libgomp runtime dependency
if (win) flags.push("-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded", "-DGGML_OPENMP=OFF"); // no VC++ redistributable needed

const build = path.join(src, "build-recap");
run("cmake", ["-S", src, "-B", build, ...flags]);
run("cmake", ["--build", build, "--config", "Release", "--target", "whisper-cli", "-j", String(os.availableParallelism())]);

const exe = win ? "whisper-cli.exe" : "whisper-cli";
const out = [path.join(build, "bin", "Release", exe), path.join(build, "bin", exe)].find(existsSync);
if (!out) throw new Error("whisper-cli not produced");
mkdirSync(binDir, { recursive: true });
const dest = path.join(binDir, exe);
copyFileSync(out, dest);
chmodSync(dest, 0o755);
console.log(`whisper-cli → ${dest}`);
