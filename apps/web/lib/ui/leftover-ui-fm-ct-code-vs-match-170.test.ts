import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Code vs match choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Log commits, version bumps, and tuning next to match auto/teleop points. Empty/setup one primary; related **Code Coach · Deploy log · CAD**; Next-actions on ready. Setup badge is **Needs setup**. Last snapshot stays on this phone (`feature: \"code-perf\"`, `if (!view)`). Student chrome is **Code vs match**, not Code-vs-Match Detective. Counts come from logged rows only. No-team primary is **Choose your team**.");
  });
});
