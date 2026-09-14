import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Pit Repair Triage choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Fix-vs-swap from FMEA + spares + time-to-match; CD **I104 reinspect before queue** cue on open/staged fix or swap Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
