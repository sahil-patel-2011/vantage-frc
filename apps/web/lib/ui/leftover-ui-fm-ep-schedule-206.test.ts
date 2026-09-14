import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Schedule empty primary student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Event match board; empty/setup + next actions; last snapshot stays on this phone. Setup badge is **Needs setup**. Empty is **No matches yet** with no setup tone — awaiting official scores is not a Vantage gap. No-team primary is **Choose your team**. Student copy says matches are synced, not a TBA cache. Empty keeps one primary.");
  });
});
