import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Pair this computer needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Approve a pairing code for Onshape or Fusion. Fixture heading stays; picker label is **Team**. No team is one **Choose your team** primary. No OAuth / CLI / env names. Setup badge is **Needs setup**.");
  });
});
