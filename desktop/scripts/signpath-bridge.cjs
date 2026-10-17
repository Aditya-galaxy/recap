// Hands files that electron-builder wants signed to SignPath, through the official SignPath GitHub action.
//
// SignPath's free signing for open source only signs artifacts submitted by that action from CI (so every signed
// binary provably comes from this repository). electron-builder, though, signs as it builds: the NSIS uninstaller
// is generated mid-build and must be signed before it's packed into the installer. So the builder runs in the
// background with this file as its sign hook; the hook stages each file and waits, a workflow step submits it with
// the action, and `accept` puts the signed file back so the build continues.
//
//   electron-builder sign hook:   win.signtoolOptions.sign = ./scripts/signpath-bridge.cjs
//   node signpath-bridge.cjs wait <n>     → waits for staged request n, prints its staged folder (for upload)
//   node signpath-bridge.cjs accept <n> <signedDir>  → checks the signed file, hands it back to the builder
//   node signpath-bridge.cjs check <dir>  → fails unless every .exe/.dll under dir carries a signature
//   node signpath-bridge.cjs build <electron-builder args…>  → starts the build in the background (detached)
//   node signpath-bridge.cjs finish       → waits for that build, prints its log, exits with its exit code
//
// Files that are already signed (the app folder, signed in an earlier request) pass straight through.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const STAGE = process.env.SIGNPATH_STAGE || path.join(process.env.RUNNER_TEMP || require("node:os").tmpdir(), "signpath-stage");
const TIMEOUT_MS = 40 * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Does this PE file carry an Authenticode signature (a certificate table)? */
function isSigned(file) {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(4096);
    fs.readSync(fd, head, 0, 4096, 0);
    if (head.readUInt16LE(0) !== 0x5a4d) return false; // "MZ"
    const pe = head.readUInt32LE(0x3c);
    const magic = head.readUInt16LE(pe + 24);
    const dirs = pe + 24 + (magic === 0x20b ? 112 : 96);
    return head.readUInt32LE(dirs + 4 * 8 + 4) > 0; // IMAGE_DIRECTORY_ENTRY_SECURITY size
  } finally {
    fs.closeSync(fd);
  }
}

let seq = 0;

/** electron-builder 26 calls this for each file it signs: ({ path, hash, isNest }, packager). */
async function sign(configuration) {
  const source = path.resolve(configuration.path);
  if (configuration.isNest || isSigned(source)) return; // sha256 only; already-signed files need nothing
  const n = ++seq;
  const dir = path.join(STAGE, String(n));
  fs.mkdirSync(path.join(dir, "unsigned"), { recursive: true });
  const staged = path.join(dir, "unsigned", path.basename(source));
  fs.copyFileSync(source, staged);
  fs.writeFileSync(path.join(dir, "request.json"), JSON.stringify({ source, name: path.basename(source), sha256: sha256(source) }));
  console.log(`[signpath-bridge] waiting for request ${n}: ${path.basename(source)}`);
  const done = path.join(dir, "signed.ok");
  const started = Date.now();
  while (!fs.existsSync(done)) {
    if (Date.now() - started > TIMEOUT_MS) throw new Error(`SignPath request ${n} (${path.basename(source)}) timed out`);
    await sleep(1000);
  }
  fs.copyFileSync(path.join(dir, "signed", path.basename(source)), source);
  console.log(`[signpath-bridge] request ${n} signed: ${path.basename(source)}`);
}

async function cli([cmd, a, b, ...rest]) {
  if (cmd === "build") {
    // Detached so it outlives this workflow step; its output goes to a log the finish step prints.
    fs.mkdirSync(STAGE, { recursive: true });
    const log = fs.openSync(path.join(STAGE, "build.log"), "w");
    const args = [a, b, ...rest].filter((x) => x !== undefined);
    const child = require("node:child_process").spawn(
      process.execPath,
      ["-e", `const r=require("node:child_process").spawnSync(process.platform==="win32"?"npx.cmd":"npx",["electron-builder",...${JSON.stringify(args)}],{stdio:"inherit",shell:process.platform==="win32"});require("node:fs").writeFileSync(${JSON.stringify(path.join(STAGE, "build.exit"))},String(r.status??1))`],
      { detached: true, stdio: ["ignore", log, log], env: { ...process.env, SIGNPATH_STAGE: STAGE } },
    );
    child.unref();
    console.log(`[signpath-bridge] installer build started (log: ${path.join(STAGE, "build.log")})`);
    return;
  }
  if (cmd === "finish") {
    const exit = path.join(STAGE, "build.exit");
    const started = Date.now();
    while (!fs.existsSync(exit)) {
      if (Date.now() - started > TIMEOUT_MS) throw new Error("the installer build didn't finish");
      await sleep(1000);
    }
    process.stdout.write(fs.readFileSync(path.join(STAGE, "build.log"), "utf8"));
    const code = Number(fs.readFileSync(exit, "utf8"));
    if (code !== 0) throw new Error(`electron-builder exited ${code}`);
    return;
  }
  if (cmd === "wait") {
    const dir = path.join(STAGE, String(a));
    const started = Date.now();
    while (!fs.existsSync(path.join(dir, "request.json"))) {
      if (Date.now() - started > TIMEOUT_MS) throw new Error(`no signing request ${a} was staged`);
      // The build ended without asking for this file: show why instead of waiting out the timeout.
      if (fs.existsSync(path.join(STAGE, "build.exit"))) {
        process.stderr.write(fs.readFileSync(path.join(STAGE, "build.log"), "utf8"));
        throw new Error(`the installer build ended before signing request ${a}`);
      }
      await sleep(1000);
    }
    await sleep(500); // the copy is finished before request.json is written; this is just margin
    process.stdout.write(path.join(dir, "unsigned"));
    return;
  }
  if (cmd === "accept") {
    const dir = path.join(STAGE, String(a));
    const req = JSON.parse(fs.readFileSync(path.join(dir, "request.json"), "utf8"));
    const signed = path.join(b, req.name);
    if (!fs.existsSync(signed)) throw new Error(`SignPath returned no ${req.name}`);
    if (!isSigned(signed)) throw new Error(`${req.name} came back without a signature`);
    // The signed file must be the one we sent, plus a signature: same size apart from the appended certificate.
    if (fs.statSync(signed).size <= fs.statSync(path.join(dir, "unsigned", req.name)).size) throw new Error(`${req.name}: unexpected signed size`);
    fs.mkdirSync(path.join(dir, "signed"), { recursive: true });
    fs.copyFileSync(signed, path.join(dir, "signed", req.name));
    fs.writeFileSync(path.join(dir, "signed.ok"), "");
    return;
  }
  if (cmd === "check") {
    const bad = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(exe|dll)$/i.test(e.name) && !isSigned(p)) bad.push(path.relative(a, p));
      }
    };
    walk(a);
    if (bad.length) throw new Error(`unsigned files:\n  ${bad.join("\n  ")}`);
    console.log(`[signpath-bridge] every .exe and .dll under ${a} is signed`);
    return;
  }
  throw new Error("usage: wait <n> | accept <n> <signedDir> | check <dir> | build <args…> | finish");
}

module.exports = sign;
module.exports.default = sign;
module.exports.isSigned = isSigned;
if (require.main === module) cli(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
