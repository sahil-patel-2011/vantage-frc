import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Batteries setup wording student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Pack list, rotation, Killer Bees **cart slots** (15 min cool-down → Beak test → Ready from real charge logs); **break-in cue** when logged match/practice cycles are under 3; **over-discharge cue** when last rest voltage is under 12.0 V after cycles; IR/cycles from logs only. Empty keeps one **Add a battery** primary; related stays in the header. Next-actions paint only on ready. Setup keeps one **Choose your team** primary. Last snapshot stays on the phone (`if (!view)`); a failed refresh does not blank a painted board. Charge logs queue when venue Wi-Fi drops. Setup badge is **Needs setup**. Empty keeps one primary. Student chrome says **Needs setup**, not Setup.");
  });
});
