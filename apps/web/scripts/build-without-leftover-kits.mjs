/**
 * Leftover volume kits live under app/win-kit, app/lovat-kit, app/agent-kit
 * (~1780 cloned page.tsx files). Next still walks them after eslint / tsc /
 * vitest skip those trees, and CI's `next build` dies compiling them.
 *
 * Move the dirs out of app/ for this process only — do not mass-edit the kits.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(webRoot, "app");
const stashDir = join(webRoot, ".leftover-kit-stash");
const KITS = ["win-kit", "lovat-kit", "agent-kit"];

function restoreKits() {
  for (const kit of KITS) {
    const from = join(stashDir, kit);
    const to = join(appDir, kit);
    if (existsSync(from) && !existsSync(to)) renameSync(from, to);
  }
  if (existsSync(stashDir)) {
    try {
      rmSync(stashDir, { recursive: true, force: true });
    } catch {
      // Best-effort: a leftover empty stash dir is harmless.
    }
  }
}

function stashKits() {
  mkdirSync(stashDir, { recursive: true });
  for (const kit of KITS) {
    const from = join(appDir, kit);
    const to = join(stashDir, kit);
    if (existsSync(from)) renameSync(from, to);
  }
}

restoreKits();
stashKits();

let status = 1;
try {
  const nextBin = require.resolve("next/dist/bin/next");
  const result = spawnSync(process.execPath, [nextBin, "build"], {
    cwd: webRoot,
    stdio: "inherit",
    env: process.env,
  });
  status = result.status ?? 1;
} finally {
  restoreKits();
}

process.exit(status);
