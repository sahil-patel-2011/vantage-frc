import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Season Report empty primary student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("retrospective from logged entries only; empty/setup + next actions; metered snapshot cutoff banner; cross-links to Strategy / Impact / Decision Search Setup badge is **Needs setup**. No-team primary is **Choose your team**. Empty keeps one primary.");
  });
});
