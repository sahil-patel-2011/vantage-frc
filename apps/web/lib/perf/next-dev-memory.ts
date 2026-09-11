/**
 * Next 16 `next dev` preloads every route into memory on start, then restarts
 * when used heap passes 80% of the V8 limit (`devMemoryThresholdRestart`).
 * A Playwright walk that compiles 100+ routes used to hit that and drop the
 * server (connection-refused for the rest of the suite).
 *
 * Keep the fixture heap at 4 GB so GitHub Actions' 7 GB runner is not OS-killed.
 * Batches (`--shard=1/4`) plus `preloadEntriesOnStart: false` keep one next-dev
 * from compiling the whole catalog in one process.
 */

export const PLAYWRIGHT_NEXT_HEAP_MB = 4096;
export const PLAYWRIGHT_SHARD_TOTAL = 4;

export function isPlaywrightNextDev(env: NodeJS.Dict<string> = process.env): boolean {
  return env.E2E_AUTH_FIXTURE === "1";
}

/** Replace any existing `--max-old-space-size` so we do not pass it twice. */
export function withMaxOldSpaceSize(existing: string | undefined, mb: number): string {
  const kept = (existing ?? "")
    .split(/\s+/)
    .filter((flag) => flag.length > 0 && !/^--max[-_]old-space-size=/i.test(flag));
  return [...kept, `--max-old-space-size=${mb}`].join(" ");
}

export function nextDevMemoryExperimental(env: NodeJS.Dict<string> = process.env): {
  webpackMemoryOptimizations: true;
  memoryBasedWorkersCount: true;
  preloadEntriesOnStart: false;
  cpus?: 1;
  devMemoryThresholdRestart?: false;
} {
  const playwright = isPlaywrightNextDev(env);
  return {
    webpackMemoryOptimizations: true,
    memoryBasedWorkersCount: true,
    preloadEntriesOnStart: false,
    ...(playwright ? { cpus: 1 as const, devMemoryThresholdRestart: false as const } : {}),
  };
}
