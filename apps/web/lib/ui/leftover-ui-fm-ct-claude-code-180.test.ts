import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Claude Code choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Pair Claude Code on one computer so Ask AI runs on that plan — no API key. Three-step setup; approve an 8-character code. Setup badge is **Needs setup**. One **Approve this computer** primary. Last snapshot (`feature: \"ai-bridge\"`). Help `/help/ai-bridge`. No-team primary is **Choose your team**.");
  });
});
