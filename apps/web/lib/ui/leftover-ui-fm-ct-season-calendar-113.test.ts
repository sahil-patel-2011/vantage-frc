import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Season calendar choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Kickoff-relative milestones. Last snapshot stays on the phone; ticking a date or adding one queues and uploads on reconnect. Seeding a whole template needs a connection. Help `/help/season-calendar`. ⌘K \"season calendar\" opens this page, not the shop calendar. Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
