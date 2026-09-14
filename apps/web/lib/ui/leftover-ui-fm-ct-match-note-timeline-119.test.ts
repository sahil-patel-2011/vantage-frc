import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Match note timeline choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Clock-stamped notes plus QRScout-style 1D action tracker (s/c/p/d) from real notes or pasted hold ranges. Confirmed video analysis events for the same match key sit on the same timeline as **From video** evidence — they are not merged into scouting. Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
