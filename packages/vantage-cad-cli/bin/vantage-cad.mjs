#!/usr/bin/env node
/**
 * Stable bin entry for vantage-cad.
 * Prefers compiled dist when present; otherwise runs TypeScript via tsx (monorepo / tarball).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distEntry = join(root, "dist", "cli.js");
const srcEntry = join(root, "src", "cli.ts");
const args = process.argv.slice(2);

if (existsSync(distEntry)) {
  await import(pathToFileURL(distEntry).href);
} else if (existsSync(srcEntry)) {
  const tsxCli = join(root, "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
  const runner = existsSync(tsxCli) ? process.execPath : process.execPath;
  const runnerArgs = existsSync(tsxCli)
    ? [tsxCli, srcEntry, ...args]
    : ["--import", "tsx", srcEntry, ...args];
  const child = spawn(runner, runnerArgs, { stdio: "inherit", shell: false, env: process.env });
  child.on("exit", (code) => process.exit(code ?? 1));
} else {
  console.error("vantage-cad: neither dist/cli.js nor src/cli.ts found");
  process.exit(1);
}
