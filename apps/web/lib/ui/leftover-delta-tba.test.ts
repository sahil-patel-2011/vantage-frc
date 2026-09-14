import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Match delta student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "lib/match-delta-watcher/match-delta-watcher-related.ts"), "utf8");
    expect(src).not.toMatch(/The Blue Alliance/);
    expect(src).toMatch(/Team Data/);
  });
});
