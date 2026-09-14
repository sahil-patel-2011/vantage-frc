import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Code Coach choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Local free pattern review + teach-not-do lessons; **supply current limit** flag when motors are constructed in pasted source without a limit API; empty/setup + next actions; clear local-vs-metered strip; UsageCutoffBanner on AI hub (metered neighbors); cross-links to CAD / GitHub / AI chat. `code-client.tsx` stays skip-list for last-snapshot — student copy only, no fake last-snapshot. Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
