import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Writer choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Grant/sponsor drafts from the team profile only. Setup badge is **Needs setup**. Templates work without a key; provider-missing offers one **Connect Claude Code** primary. Header related is **Grants · Awards · Knowledge**; AI neighbors include Claude Code. Next-actions stay on the live workspace. UsageCutoffBanner on metered Assistant. No-team primary is **Choose your team**.");
  });
});
