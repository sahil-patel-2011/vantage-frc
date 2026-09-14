import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Competition needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("**Event day · Scouting · Strategy · Pit** — related tools are inner tabs, not a More-tools dump (My Day under Event day, Forms under Scouting, Alliance desk under Strategy) Setup badge is **Needs setup**.");
  });
});
