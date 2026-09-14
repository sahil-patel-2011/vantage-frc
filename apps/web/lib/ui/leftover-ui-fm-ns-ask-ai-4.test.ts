import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Ask AI needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Not a workspace any more. One \"Ask AI\" control on every page opens the chat; keys / budgets / governance / memory / usage live under Settings; Writer, decision notes and the season report under Team › Playbook; Code assist and Bugbot under Build › Code. The `/ai` page and its tabs still resolve (hidden hub in `hubs.ts`) Setup badge is **Needs setup**.");
  });
});
