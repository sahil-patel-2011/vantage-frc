import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Match strategy cards choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Drive-team game plan per event match; AllianceOps-style Safe / Balanced / Aggressive duty templates; **agree autos with alliance partners** when Auto is blank; **backup auto** when Auto is a single rigid path; **deploy vs stow** when hood/hopper is written without trench language. Setup badge is **Needs setup**. Related: Strategy · Match checklist · Event day. Next-actions say **Open Event day**, not Open Command. Student header does not say TBA match. No-team primary is **Choose your team**.");
  });
});
