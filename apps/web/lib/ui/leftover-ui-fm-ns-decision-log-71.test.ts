import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Decision Log needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("ADR-style log from recorded decisions only; empty/setup + next actions; entry clarity (context/options/decision/why); cross-links to Decision Search / Season Report / Knowledge Setup badge is **Needs setup**.");
  });
});
