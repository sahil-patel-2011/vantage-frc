import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Decision Search needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("semantic search over indexed decisions / design reviews / notebook entries; empty/setup + next actions; metered search cutoff banner; cross-links to Season Report / Knowledge / Strategy Setup badge is **Needs setup**.");
  });
});
