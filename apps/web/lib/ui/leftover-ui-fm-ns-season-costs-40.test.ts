import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Season Costs needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Real-world spend + subscriptions + live usage ledger vs season budget; empty/setup + next actions; remaining/% blank until budget set; cross-links to Orders / Fundraisers / Business budget Setup badge is **Needs setup**.");
  });
});
