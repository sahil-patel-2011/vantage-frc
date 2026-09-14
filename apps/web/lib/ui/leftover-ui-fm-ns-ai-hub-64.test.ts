import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map AI hub needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("ProductHubShell tabs; HubOrgGate empty/setup; AiHubRelated + Usage via hubHref; Writer receives orgId; More tools to Usage / Decisions / Season Report Setup badge is **Needs setup**.");
  });
});
