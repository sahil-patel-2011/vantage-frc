import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map AI Memory choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Admin opt-in team memory policy + real Neon counts; private vs team-shared clarity; empty/setup/forbidden shells. Sharing on with no rows is **Nothing shared**, not Setup — that is not a Vantage gap. Chat / Budgets stay in the related strip. Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
