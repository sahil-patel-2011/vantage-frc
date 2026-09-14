import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Scouting forms choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Form builder empty/setup + one primary; Match / Pit form type is a ToolStrip (not a second tab bar); custom schemas; **pit default** is drivetrain / language / driver experience / photos (CD: no claimed scoring); claimed-scoring lint on pit drafts. Load/mutate/shell is `forms-client.tsx`; chrome, option/settings editors, and preview live in sibling modules. No-team primary is **Choose your team**.");
  });
});
