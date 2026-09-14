import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Inspection Copilot choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Student title is **Inspection**. Weight / frame-bumper / wiring flags only when those statuses are logged; empty/setup + next actions. Setup badge is **Needs setup**. Last snapshot stays on this phone. `/inspection` checklist setup is **Needs setup**; related links to Inspection, not Inspection copilot. No-team primary is **Choose your team**.");
  });
});
