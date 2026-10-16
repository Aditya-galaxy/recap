// Builds a self-contained llama-completion (llama.cpp) for this platform into desktop/bin. It runs the optional
// on-device model that polishes guide steps. Needs git, cmake and a C/C++ toolchain, like build-whisper.mjs.
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "v0.6.0";
const win = process.platform === "win32";
const binDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin");
const src = path.join(os.tmpdir(), `llama.cpp-${VERSION}`);
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

if (!existsSync(path.join(src, "CMakeLists.txt"))) {
  rmSync(src, { recursive: true, force: true });
  run("git", ["clone", "--depth", "1", "--branch", VERSION, "https://github.com/ggml-org/llama.cpp", src]);
}

const flags = [
  "-DCMAKE_BUILD_TYPE=Release",
  "-DBUILD_SHARED_LIBS=OFF", // one binary, no ggml/llama shared libs to ship
  "-DLLAMA_BUILD_TESTS=OFF",
  "-DLLAMA_BUILD_EXAMPLES=OFF",
  "-DLLAMA_BUILD_SERVER=OFF",
  "-DLLAMA_CURL=OFF", // models are downloaded by the app, never by llama.cpp
  "-DLLAMA_OPENSSL=OFF", // no HTTPS in the binary either, so no OpenSSL to ship
  "-DGGML_NATIVE=OFF", // portable: don't tune for the build machine's CPU
];
if (process.platform === "darwin") flags.push("-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0"); // Metal stays on (GPU)
if (process.platform === "linux") flags.push("-DGGML_OPENMP=OFF");
if (win) flags.push("-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded", "-DGGML_OPENMP=OFF");

const build = path.join(src, "build-recap");
run("cmake", ["-S", src, "-B", build, ...flags]);
run("cmake", ["--build", build, "--config", "Release", "--target", "llama-completion", "-j", String(os.availableParallelism())]);

const exe = win ? "llama-completion.exe" : "llama-completion";
const out = [path.join(build, "bin", "Release", exe), path.join(build, "bin", exe)].find(existsSync);
if (!out) throw new Error("llama-completion not produced");
mkdirSync(binDir, { recursive: true });
const dest = path.join(binDir, exe);
copyFileSync(out, dest);
chmodSync(dest, 0o755);
console.log(`llama-completion → ${dest}`);
