// electron-builder always drops node_modules from extraResources, but the bundled engine (a Next.js
// standalone server) needs its own. Copy them in after packaging and before code signing.
const { cpSync, existsSync } = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  const resources =
    electronPlatformName === "darwin"
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(appOutDir, "resources");
  const from = path.join(__dirname, "..", "engine", "node_modules");
  const to = path.join(resources, "engine", "node_modules");
  if (!existsSync(from)) throw new Error("engine/node_modules missing: run `npm run engine` first");
  cpSync(from, to, { recursive: true, verbatimSymlinks: true });
  if (!existsSync(path.join(to, "next", "package.json"))) throw new Error("engine node_modules copy failed");
  console.log(`  • copied engine node_modules → ${path.relative(appOutDir, to)}`);
};
