import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Software versions choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Installed vs target for WPILib, images, and vendor libraries. Empty/setup one primary; related **CAN-bus map · Code · Tuning log**; Next-actions on ready. Setup badge is **Needs setup**. Last snapshot stays on this phone (`feature: \"software-versions\"`, `if (!view)`). Empty means nothing is on file — not a claimed match. No-team primary is **Choose your team**.");
  });
});
