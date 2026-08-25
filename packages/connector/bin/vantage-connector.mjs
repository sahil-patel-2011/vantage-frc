#!/usr/bin/env node
/**
 * Stable bin entry for vantage-connector (same shape as packages/vantage-cad-cli/bin).
 * Prefers the compiled dist; falls back to running the TypeScript source through tsx so a
 * monorepo checkout works before `npm run build`. Stdlib only — this file must start on a
 * Raspberry Pi with nothing installed but Node.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distEntry = join(root, "dist", "node", "cli-main.js");
const srcEntry = join(root, "src", "node", "cli-main.ts");
const args = process.argv.slice(2);

if (existsSync(distEntry)) {
  const { main } = await import(pathToFileURL(distEntry).href);
  process.exitCode = await main(args);
} else if (existsSync(srcEntry)) {
  const tsxCli = join(root, "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
  const runnerArgs = existsSync(tsxCli)
    ? [tsxCli, srcEntry, ...args]
    : ["--import", "tsx", srcEntry, ...args];
  const child = spawn(process.execPath, runnerArgs, { stdio: "inherit", shell: false, env: process.env });
  child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
} else {
  console.error("vantage-connector: neither dist/node/cli-main.js nor src/node/cli-main.ts found");
  process.exit(1);
}
