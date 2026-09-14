import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Business setup wording student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("**Overview · Money · Sponsors · Grants · Outreach** — budget/orders under Money, packages/partners under Sponsors. Header related strip is **Sponsors · Grants · Budget**. Setup badge is **Needs setup**. Last snapshot stays on this phone (`feature: \"business\"`). Working funds stay **—** until a budget or recorded cash exists. Featured inner tool: **Budget**. No-team primary is **Choose your team**. Student chrome says **Needs setup**, not Setup.");
  });
});
