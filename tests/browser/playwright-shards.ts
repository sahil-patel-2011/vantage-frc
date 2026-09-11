import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Sequential Playwright shards so one Next 16 process does not compile
 * every student board into the same heap. Each shard starts a fresh
 * `next dev` against NEXT_DIST_DIR=.next-pw, then that cache is evicted.
 *
 * File-filter args (a spec path or name) skip sharding. Extra flags such
 * as `--reporter=line,html` still shard. PLAYWRIGHT_SHARDS overrides the
 * default of 4. PLAYWRIGHT_BASE_URL attach mode never deletes a cache.
 */

export const DEFAULT_PLAYWRIGHT_NEXT_DIST = ".next-pw";
export const DEFAULT_PLAYWRIGHT_SHARDS = 4;

export function playwrightNextDistDir(env: NodeJS.Dict<string> = process.env): string {
  const raw = env.NEXT_DIST_DIR?.trim();
  return raw || DEFAULT_PLAYWRIGHT_NEXT_DIST;
}

export function looksLikePlaywrightFileFilter(args: readonly string[]): boolean {
  return args.some((arg) => !arg.startsWith("-"));
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
  const shards = playwrightShardCount(extra, env);
  const dist = playwrightNextDistDir(env);
  const webRoot = join(repoRoot(), "apps/web");
  const attach = Boolean(env.PLAYWRIGHT_BASE_URL);
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
