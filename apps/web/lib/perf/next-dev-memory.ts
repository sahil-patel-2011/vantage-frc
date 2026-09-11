/**
 * Next 16 `next dev` preloads every route into memory on start, then restarts
 * when used heap passes 80% of the V8 limit (`devMemoryThresholdRestart`).
 * A Playwright walk that compiles 100+ routes used to hit that and drop the
 * server (connection-refused for the rest of the suite).
 *
 * Keep the fixture heap at 4 GB so GitHub Actions' 7 GB runner is not OS-killed
 * (8 GB was). `--shard=1/4` still compiled ~76 tests into one next and died;
 * eight shards plus `onDemandEntries` keep one compiler from holding the catalog.
 * `preloadEntriesOnStart: false` is the other half of route-compile.
 */

export const PLAYWRIGHT_NEXT_HEAP_MB = 4096;
export const PLAYWRIGHT_SHARD_TOTAL = 8;
export const PLAYWRIGHT_ON_DEMAND_MAX_INACTIVE_AGE_MS = 12_000;
export const PLAYWRIGHT_ON_DEMAND_PAGES_BUFFER = 2;

export function playwrightNextDistDir(port: number): string {
  return `.next-pw-${port}`;
}

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

export function playwrightOnDemandEntries(env: NodeJS.Dict<string> = process.env):
  | {
      maxInactiveAge: number;
      pagesBufferLength: number;
    }
  | undefined {
  if (!isPlaywrightNextDev(env)) return undefined;
  return {
    maxInactiveAge: PLAYWRIGHT_ON_DEMAND_MAX_INACTIVE_AGE_MS,
    pagesBufferLength: PLAYWRIGHT_ON_DEMAND_PAGES_BUFFER,
  };
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
