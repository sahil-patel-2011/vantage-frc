import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Chat limits choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Spend and token limits, which models are allowed, Pause Chat for everyone. Cutoff banners send people to Pricing or Chat limits. Setup badge is **Needs setup**. Spend tiles stay **—** until a real ledger exists — no invented `$0.00`. No-team primary is **Choose your team**.");
  });
});
