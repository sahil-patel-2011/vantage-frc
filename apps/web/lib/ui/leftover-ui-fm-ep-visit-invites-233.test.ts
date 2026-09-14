import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Visit Invites empty primary student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Shop tours / demo days, hosts, RSVPs; empty/setup + next actions; cross-links to Logistics / Event Day / Calendar Setup badge is **Needs setup**. No-team primary is **Choose your team**. Empty keeps one primary.");
  });
});
