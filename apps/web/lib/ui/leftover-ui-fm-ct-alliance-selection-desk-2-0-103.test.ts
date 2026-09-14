import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Alliance Selection Desk 2.0 choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Live 8-alliance pick board with shared slots, scout evidence attach, ranking conflict flags vs event numbers, drive-team export/print. Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
