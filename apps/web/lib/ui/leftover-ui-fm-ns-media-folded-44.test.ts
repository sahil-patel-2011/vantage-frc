import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Media (folded) needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Content calendar, drafts, reminders, kit and the photo/video library are Outreach tools now — one fewer pillar. The `/media` page and its tabs still resolve (hidden hub in `hubs.ts`) Setup badge is **Needs setup**.");
  });
});
