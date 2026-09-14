import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map AI Governance empty primary student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Which Chat features and tools members may use, high-cost approvals, spend alerts, Finance in Ask AI consent; empty/setup/forbidden shells. Incomplete policy is **Needs setup**, not Setup. Memory / Chat limits / Chat stay in the related strip. Setup badge is **Needs setup**. No-team primary is **Choose your team**. Empty keeps one primary.");
  });
});
