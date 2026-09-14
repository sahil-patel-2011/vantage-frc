import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Business impact & awards choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("outreach log + readiness from recorded activities; award essays from catalog submissions. Setup badge is **Needs setup**. Empty keeps one primary; next-actions stay off empty. Readiness / hours / reach stay blank until logged. Header related strip is **Outreach · Awards · Writer** — not Sponsors / Grants / Budget. Last snapshot stays on this phone (`feature: \"impact\"` / `\"awards\"`). No-team primary is **Choose your team**.");
  });
});
