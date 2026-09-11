import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLAYWRIGHT_NEXT_HEAP_MB,
  PLAYWRIGHT_SHARD_TOTAL,
  isPlaywrightNextDev,
  nextDevMemoryExperimental,
  withMaxOldSpaceSize,
} from "./next-dev-memory";

const WEB_ROOT = join(__dirname, "..", "..");

describe("next-dev memory", () => {
  it("caps the Playwright heap at 4 GB so the GitHub Actions runner is not OS-killed", () => {
    expect(PLAYWRIGHT_NEXT_HEAP_MB).toBe(4096);
    expect(PLAYWRIGHT_SHARD_TOTAL).toBe(8);
    expect(withMaxOldSpaceSize(undefined, PLAYWRIGHT_NEXT_HEAP_MB)).toBe(
      "--max-old-space-size=4096",
    );
    expect(withMaxOldSpaceSize("--max-old-space-size=8192 --trace-gc", 4096)).toBe(
      "--trace-gc --max-old-space-size=4096",
    );
  });

  it("does not preload every route on start, and disables memory restart under the fixture", () => {
    expect(isPlaywrightNextDev({})).toBe(false);
    const interactive = nextDevMemoryExperimental({});
    expect(interactive.preloadEntriesOnStart).toBe(false);
    expect(interactive.webpackMemoryOptimizations).toBe(true);
    expect(interactive.memoryBasedWorkersCount).toBe(true);
    expect(interactive.devMemoryThresholdRestart).toBeUndefined();
    expect(interactive.cpus).toBeUndefined();

    const fixture = nextDevMemoryExperimental({ E2E_AUTH_FIXTURE: "1" });
    expect(isPlaywrightNextDev({ E2E_AUTH_FIXTURE: "1" })).toBe(true);
    expect(fixture.preloadEntriesOnStart).toBe(false);
    expect(fixture.devMemoryThresholdRestart).toBe(false);
    expect(fixture.cpus).toBe(1);
  });

  it("wires the helper into next.config", () => {
    const src = readFileSync(join(WEB_ROOT, "next.config.ts"), "utf8");
    expect(src).toMatch(/nextDevMemoryExperimental/);
    expect(src).toMatch(/experimental:\s*nextDevMemoryExperimental\(\)/);
    expect(src).not.toMatch(/playwrightOnDemandEntries/);
    expect(src).toMatch(/distDir:\s*process\.env\.NEXT_DIST_DIR/);
  });

  it("shards the GitHub Actions Playwright job so one next-dev does not compile 117 tests", () => {
    const workflow = readFileSync(
      join(WEB_ROOT, "..", "..", ".github", "workflows", "web.yml"),
      "utf8",
    );
    expect(workflow).toMatch(/NODE_OPTIONS: "--max-old-space-size=4096"/);
    expect(workflow).toMatch(/shard: \[1, 2, 3, 4, 5, 6, 7, 8\]/);
    expect(workflow).toMatch(/--shard=\$\{\{ matrix\.shard \}\}\/8/);
  });

  it("does not let Playwright load vitest origin.test.ts as a spec", () => {
    const config = readFileSync(join(WEB_ROOT, "..", "..", "playwright.config.ts"), "utf8");
    expect(config).toMatch(/testMatch:\s*["']\*\*\/\*\.spec\.ts["']/);
    expect(config).toMatch(/playwrightOwnedPort/);
    expect(config).toMatch(/playwrightOwnedOrigin/);
    expect(config).not.toMatch(/explicitBase/);
    expect(config).toMatch(/--shard=1\/8/);
  });
});
