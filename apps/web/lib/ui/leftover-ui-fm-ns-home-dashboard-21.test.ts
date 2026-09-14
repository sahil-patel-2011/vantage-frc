import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Home dashboard needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Per-member personal layout. **What to do now** is one live next action: next match or duty → My Day, open clock-in → My Hours, todos → Todos; empty still says **Nothing you have to do right now.** No TBA / Connect TBA / The Blue Alliance in student chrome. Empty widgets use catalog hints — API messages that name TBA / EPA / Statbotics never paint. **Live widgets only** — empty cards stay off until Edit Home. **Bottom island keeps four customizable apps on every screen size** (Home · Compete · Team · Build by default) plus a fixed, labeled **All** control — the *only* control that opens the nav panel Setup badge is **Needs setup**.");
  });
});
