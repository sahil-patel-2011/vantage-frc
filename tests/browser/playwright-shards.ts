import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Sequential Playwright shards so one Next 16 process does not compile
 * every student board into the same heap. Each shard starts a fresh
 * `next dev` against NEXT_DIST_DIR=.next-pw, then that cache is evicted.
 *
 * File-filter args (a spec path or name) skip numbered sharding. Two or
 * more `*.spec.ts` paths each get their own sequential process so one
 * Next 16 heap does not compile every named board. Extra flags such as
 * `--reporter=line,html` still shard. PLAYWRIGHT_SHARDS overrides the
 * default of 4. PLAYWRIGHT_BASE_URL attach mode never deletes a cache.
 */

export const DEFAULT_PLAYWRIGHT_NEXT_DIST = ".next-pw";
export const DEFAULT_PLAYWRIGHT_SHARDS = 4;

export function playwrightNextDistDir(env: NodeJS.Dict<string> = process.env): string {
  const raw = env.NEXT_DIST_DIR?.trim();
  return raw || DEFAULT_PLAYWRIGHT_NEXT_DIST;
}

const FLAGS_WITH_VALUES = new Set([
  "--grep",
  "-g",
  "--reporter",
  "--project",
  "--workers",
  "--repeat-each",
  "--retries",
  "--timeout",
  "--output",
  "--config",
  "-c",
  "--shard",
]);

export function playwrightFileFilterArgs(args: readonly string[]): string[] {
  const files: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("-")) {
      const name = arg.split("=", 1)[0];
      if (FLAGS_WITH_VALUES.has(name) && !arg.includes("=")) index += 1;
      continue;
    }
    files.push(arg);
  }
  return files;
}

export function looksLikePlaywrightFileFilter(args: readonly string[]): boolean {
  return playwrightFileFilterArgs(args).length > 0;
}

export function playwrightIsolatedSpecFiles(args: readonly string[]): string[] {
  if (args.some((arg) => arg === "--shard" || arg.startsWith("--shard="))) return [];
  const files = playwrightFileFilterArgs(args);
  if (files.length < 2) return [];
  if (!files.every((file) => /\.spec\.[cm]?[jt]s$/.test(file))) return [];
  return files;
}

export function playwrightShardCount(
  args: readonly string[],
  env: NodeJS.Dict<string> = process.env,
): number {
  if (args.some((arg) => arg === "--shard" || arg.startsWith("--shard="))) return 1;
  if (looksLikePlaywrightFileFilter(args)) return 1;
  const explicit = Number(env.PLAYWRIGHT_SHARDS);
  if (Number.isFinite(explicit) && explicit >= 1) return Math.floor(explicit);
  return DEFAULT_PLAYWRIGHT_SHARDS;
}

export function evictPlaywrightNextDist(webRoot: string, distDir: string): void {
  if (!distDir || distDir.includes("..") || distDir.startsWith("/") || distDir.includes("\\")) {
    throw new Error(`refusing to evict NEXT_DIST_DIR=${distDir}`);
  }
  rmSync(join(webRoot, distDir), { recursive: true, force: true });
}

function repoRoot(): string {
  return resolve(fileURLToPath(new URL("../..", import.meta.url)));
}

export function runPlaywrightShards(
  extra: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): number {
  const dist = playwrightNextDistDir(env);
  const webRoot = join(repoRoot(), "apps/web");
  const attach = Boolean(env.PLAYWRIGHT_BASE_URL);
  const isolated = attach ? [] : playwrightIsolatedSpecFiles(extra);
  if (isolated.length > 0) {
    const flags = extra.filter((arg) => !isolated.includes(arg));
    let failed = 0;
    for (const spec of isolated) {
      evictPlaywrightNextDist(webRoot, dist);
      const result = spawnSync("npx", ["playwright", "test", spec, ...flags], {
        cwd: repoRoot(),
        stdio: "inherit",
        env: { ...env, NEXT_DIST_DIR: dist },
      });
      const code = result.status ?? 1;
      if (code !== 0) {
        failed = code;
        break;
      }
    }
    return failed;
  }
  const shards = playwrightShardCount(extra, env);
  let failed = 0;
  for (let index = 1; index <= shards; index += 1) {
    if (!attach) evictPlaywrightNextDist(webRoot, dist);
    const args = ["playwright", "test", ...extra];
    if (shards > 1) args.push(`--shard=${index}/${shards}`);
    const result = spawnSync("npx", args, {
      cwd: repoRoot(),
      stdio: "inherit",
      env: { ...env, NEXT_DIST_DIR: dist },
    });
    const code = result.status ?? 1;
    if (code !== 0) {
      failed = code;
      break;
    }
  }
  return failed;
}

const invokedDirectly =
  !process.env.VITEST &&
  process.argv[1] != null &&
  /playwright-shards\.(ts|js|mts|mjs)$/.test(process.argv[1]);

if (invokedDirectly) {
  process.exit(runPlaywrightShards(process.argv.slice(2)));
}
