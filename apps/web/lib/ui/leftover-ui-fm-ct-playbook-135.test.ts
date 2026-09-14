import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Playbook choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Season wiki; Start season playbook on empty; page list + editor; mutations stay on this team. Setup badge is **Needs setup**. Related **Team chat · FMEA · Decisions**. Last snapshot stays on this phone (`feature: \"knowledge\"`, `if (!view)`). No-team primary is **Choose your team**.");
  });
});
