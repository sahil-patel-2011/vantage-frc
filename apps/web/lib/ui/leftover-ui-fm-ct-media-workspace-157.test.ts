import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Media workspace choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("TabBar: Calendar · Drafts · Reminders · Kit · Impact — content CRUD + metered caption drafts + due reminders; Business More tools Media Kit / Outreach deep-link here; Help `/help/media-workspace`; empty/setup. Setup badge is **Needs setup**. Empty keeps one **Build Media Kit** primary. No-team primary is **Choose your team**.");
  });
});
