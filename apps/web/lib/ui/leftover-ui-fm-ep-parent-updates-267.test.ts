import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Parent updates empty primary student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("One-way weekly family updates: contacts + digest + token view. Empty/setup keep one primary (**Choose your team** / **Add a parent contact**). Setup badge is **Needs setup**. Restricted (non-admin) is one **Open Home** primary. Last snapshot (`feature: \"parents\"`) stays on the phone (`if (!view)`). Header related strip is **Calendar · People · Forms**. Next-actions paint only on ready. Never names env vars. Empty keeps one primary.");
  });
});
