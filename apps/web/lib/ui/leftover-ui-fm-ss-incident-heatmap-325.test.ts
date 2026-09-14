import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Incident Heatmap setup wording student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Subsystem × week heatmap from logged robot incidents. Setup badge is **Needs setup**. Setup keeps one **Choose your team** primary. Header related strip is **Failure patterns · FMEA · Safety log**. Last snapshot (`feature: \"incident-heatmap\"`) keys the cache by season. Student chrome says **Needs setup**, not Setup.");
  });
});
