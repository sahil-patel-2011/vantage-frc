import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Team chat empty primary student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("This team channel + DMs; inbox notifications (`teamChat`); optional Slack bridge (`/team/slack`). Mentors can turn **Team chat is on** off in Settings (`/messages?settings=1`, also Settings › Chat). When off, channels and send are hidden and the API refuses writes. No-team empty is **Choose your team**. Setup badge is **Needs setup**. Empty keeps one primary.");
  });
});
