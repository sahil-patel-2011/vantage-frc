import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Robot Weigh-In choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Scale log vs limit plus CD **2026 playoff re-weigh** cue when Team Data has unplayed qf/sf/f and latest Event inspection is before that day Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
