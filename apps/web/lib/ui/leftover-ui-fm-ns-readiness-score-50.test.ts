import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Readiness Score needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Ship-readiness index from subsystems / checklist / FMEA / weight·power; empty/setup + next actions; UsageCutoffBanner on metered subsystem writes; FMEA / Inspection / Code via hubHref Setup badge is **Needs setup**.");
  });
});
