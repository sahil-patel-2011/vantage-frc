import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Print farm choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Queue prints, report printer status, and track filament by hand — not a live printer feed. Setup badge is **Needs setup**. Related **CAD · Files · Inventory**. Last snapshot stays on this phone (`feature: \"print-farm\"`, `if (!view)`). Student title is **Print farm**, not 3D Print Farm. No-team primary is **Choose your team**.");
  });
});
