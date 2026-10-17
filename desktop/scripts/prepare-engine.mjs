// Builds the Recap server (Next.js standalone) and copies it into desktop/engine, where
// electron-builder picks it up as an extra resource. Run from anywhere: `npm run engine`.
import { execSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(desktop, "..");
const dist = ".next-engine";
const out = path.join(desktop, "engine");

console.log("building Recap engine…");
execSync("npm run build", {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, RECAP_STANDALONE: "1", RECAP_DIST_DIR: dist, NEXT_TELEMETRY_DISABLED: "1" },
});

const standalone = path.join(root, dist, "standalone");
rmSync(out, { recursive: true, force: true });
cpSync(standalone, out, { recursive: true, verbatimSymlinks: true });
cpSync(path.join(root, dist, "static"), path.join(out, dist, "static"), { recursive: true });
cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });

// The file tracer can pull in local runtime data and sibling apps; none of it belongs in the engine.
for (const junk of ["data", "models", "desktop", "mac", "site", "docs", "deploy", "src", ".github"]) rmSync(path.join(out, junk), { recursive: true, force: true });
// sharp (and its LGPL libvips) only serves Next's image optimizer, which Recap doesn't use (images are unoptimized):
// 18 MB and a native module per platform that would otherwise ship and need signing.
for (const mod of ["node_modules/sharp", "node_modules/@img"]) rmSync(path.join(out, mod), { recursive: true, force: true });
if (!existsSync(path.join(out, "server.js"))) throw new Error("engine build is missing server.js");
console.log(`engine ready at ${out}`);
