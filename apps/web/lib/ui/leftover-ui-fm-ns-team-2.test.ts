import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Team needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("**Calendar · Chat · People · Work · Playbook** — hours, team profile, forms under People; practice/FMEA/batteries under Work; Files, Writer, decision notes under Playbook Setup badge is **Needs setup**.");
  });
});
