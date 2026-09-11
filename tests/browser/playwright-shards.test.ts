import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYWRIGHT_NEXT_DIST,
  DEFAULT_PLAYWRIGHT_SHARDS,
  evictPlaywrightNextDist,
  looksLikePlaywrightFileFilter,
  playwrightNextDistDir,
  playwrightShardCount,
} from "./playwright-shards";

describe("playwright shards", () => {
  it("isolates Next onto .next-pw unless NEXT_DIST_DIR is set", () => {
    expect(playwrightNextDistDir({})).toBe(DEFAULT_PLAYWRIGHT_NEXT_DIST);
    expect(playwrightNextDistDir({ NEXT_DIST_DIR: ".next-pw-3598" })).toBe(".next-pw-3598");
  });

  it("shards a full suite and skips shards when a spec is named", () => {
    expect(playwrightShardCount([], {})).toBe(DEFAULT_PLAYWRIGHT_SHARDS);
    expect(playwrightShardCount(["--reporter=line,html"], { CI: "true" })).toBe(
      DEFAULT_PLAYWRIGHT_SHARDS,
    );
    expect(playwrightShardCount(["--reporter=line,html"], { PLAYWRIGHT_SHARDS: "3" })).toBe(3);
    expect(playwrightShardCount(["tests/browser/chat-remaining.spec.ts"], {})).toBe(1);
    expect(playwrightShardCount(["chat-remaining"], {})).toBe(1);
    expect(playwrightShardCount(["--shard=2/4"], {})).toBe(1);
    expect(looksLikePlaywrightFileFilter(["--reporter=line"])).toBe(false);
  });

  it("evicts only a relative Next dist directory", () => {
    const root = mkdtempSync(join(tmpdir(), "pw-dist-"));
    const dist = join(root, ".next-pw");
    mkdirSync(join(dist, "dev"), { recursive: true });
    writeFileSync(join(dist, "dev", "lock"), "{}");
    evictPlaywrightNextDist(root, ".next-pw");
    expect(() => evictPlaywrightNextDist(root, "../secrets")).toThrow(/refusing/);
    expect(() => evictPlaywrightNextDist(root, "/tmp/nope")).toThrow(/refusing/);
    rmSync(root, { recursive: true, force: true });
  });
});
