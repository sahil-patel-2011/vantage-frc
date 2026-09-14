import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Business grants choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Pipeline + draft library + guided grant writing; empty/setup + next actions; metered AI hard-stop via UsageCutoffBanner; cross-links to sponsors / fundraisers / writer. Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
