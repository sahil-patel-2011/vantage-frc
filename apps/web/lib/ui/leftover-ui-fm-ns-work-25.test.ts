import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Work needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Combined `team_todos` + `build_tasks` on one board. **Open build board** still opens `/tasks`. Task board is not a Work tool-strip chip. Setup badge is **Needs setup**.");
  });
});
