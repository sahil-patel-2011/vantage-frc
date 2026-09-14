import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map My Day choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Live ops / now-next match; empty/setup + next actions; last snapshot stays on this phone when venue Wi-Fi dies. Hero primary is **Scout this match** when a live match exists. Ready next-actions include **Clock in** → My Hours. Setup badge is **Needs setup**. Student chrome does not say TBA / The Blue Alliance. Cross-links to Event Day / Schedule / Strategy. No-team primary is **Choose your team**.");
  });
});
