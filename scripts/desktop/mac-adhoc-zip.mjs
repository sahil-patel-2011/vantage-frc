#!/usr/bin/env node
/**
 * Build the Mac app without a Mac and without an Apple Developer account.
 *
 * electron-builder can lay out a Mac .app on Linux or Windows but cannot sign it there, and an
 * Apple silicon Mac refuses to open an app whose signature was broken by packaging ("damaged").
 * So each chip is packaged unsigned, then given an ad-hoc signature with rcodesign
 * (https://github.com/indygreg/apple-platform-rs, `cargo install apple-codesign`), then zipped
 * with its symlinks intact. macOS asks once before the first open (Privacy & Security, then
 * Open Anyway); after that it opens like any other app.
 *
 *   node scripts/desktop/mac-adhoc-zip.mjs              # both chips
 *   node scripts/desktop/mac-adhoc-zip.mjs arm64        # one chip
 *   RCODESIGN=/path/to/rcodesign node scripts/desktop/mac-adhoc-zip.mjs
 *
 * On a Mac, `npm run desktop:dist:mac:free` makes one universal .dmg instead and is simpler.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const DESKTOP = join(ROOT, "apps", "desktop");
const RELEASE = join(DESKTOP, "release");
const RCODESIGN = process.env.RCODESIGN || "rcodesign";
const { version, build } = JSON.parse(readFileSync(join(DESKTOP, "package.json"), "utf8"));
const product = build.productName;

const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const chips = requested.length ? requested : ["arm64", "x64"];
for (const chip of chips) {
  if (chip !== "arm64" && chip !== "x64") {
    console.error(`Unknown chip "${chip}". Use arm64 (Apple silicon) or x64 (Intel).`);
    process.exit(1);
  }
}

try {
  execFileSync(RCODESIGN, ["--version"], { stdio: "ignore" });
} catch {
  console.error(`rcodesign was not found (${RCODESIGN}). Install it with: cargo install apple-codesign`);
  process.exit(1);
}

const run = (cmd, args, cwd = DESKTOP) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

run("npx", ["tsc"]);
for (const chip of chips) {
  // electron-builder names the Intel folder plain "mac" and the Apple silicon one "mac-arm64".
  const outDir = join(RELEASE, chip === "arm64" ? "mac-arm64" : "mac");
  const app = join(outDir, `${product}.app`);
  const zip = join(RELEASE, `${product}-${version}-mac-${chip}.zip`);
  rmSync(outDir, { recursive: true, force: true });
  rmSync(zip, { force: true });

  run("npx", ["electron-builder", "--mac", "dir", `--${chip}`, "-c.mac.identity=null", "-c.mac.hardenedRuntime=false"]);
  if (!existsSync(app)) {
    console.error(`electron-builder did not produce ${app}.`);
    process.exit(1);
  }

  // No certificate means an ad-hoc signature: every helper, framework and the app itself.
  run(RCODESIGN, ["sign", app]);
  // `rcodesign verify` misreports ad-hoc signatures (it expects a CMS blob), so read the code
  // directory instead: the app and the Electron framework must both carry an ADHOC signature.
  for (const binary of [
    join(app, "Contents", "MacOS", product),
    join(app, "Contents", "Frameworks", "Electron Framework.framework", "Electron Framework"),
  ]) {
    const info = execFileSync(RCODESIGN, ["print-signature-info", binary], { encoding: "utf8" });
    if (!/CodeSignatureFlags\([^)]*ADHOC/.test(info)) {
      console.error(`${binary} has no ad-hoc signature; macOS would call the app damaged.`);
      process.exit(1);
    }
  }

  // -y keeps the framework symlinks as links; copies would break the signature and triple the size.
  run("zip", ["-qry", zip, `${product}.app`], outDir);
  console.log(`Wrote ${zip.replace(`${ROOT}/`, "")}`);
}
console.log("Next: node scripts/desktop/publish-release.mjs (dry run) and then --publish.");
