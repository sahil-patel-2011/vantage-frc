import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Leadership empty primary student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Who holds each role and who is next. Empty/setup keep one primary (**Choose your team** / the Add role form). Setup badge is **Needs setup**. Zeroed succession tiles stay off until a role exists. Last snapshot (`feature: \"leadership\"`) stays on the phone (`if (!view)`). Header related strip is **Season roles · Skills · Safety**. Next-actions paint only on ready. Empty keeps one primary.");
  });
});
