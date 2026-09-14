import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Pair VS Code choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Approve a VS Code pairing code. Fixture heading stays; picker label is **Team**. Setup badge is **Needs setup**. Empty keeps Approve pairing as the one primary. No-team primary is **Choose your team**.");
  });
});
