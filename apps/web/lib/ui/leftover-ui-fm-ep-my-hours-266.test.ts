import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map My hours empty primary student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Clock in / Clock out on this board. Home What-to-do-now and My Day **Clock in** land here. Empty/setup student chrome (**Needs setup** / **Clock in to start your record**). Never invents hour totals. Last snapshot stays on this phone. Setup badge is **Needs setup**. No-team primary is **Choose your team**. Empty keeps one primary.");
  });
});
