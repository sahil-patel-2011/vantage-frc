import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Goals needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Season objectives + scorecard from logged current/target values only; empty/setup + next actions; progress blank until goals exist; cross-links to Todos / Practice / Team hub Setup badge is **Needs setup**.");
  });
});
