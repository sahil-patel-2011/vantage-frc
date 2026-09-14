import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Kickoff empty primary student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Game brief from the published pack (2026 REBUILT scoring; 2027 BIOCORE stays empty until the manual). Transcript intelligence, scoring actions, design priorities, rules Q&A. Load/mutate/shell is `kickoff-client.tsx`; brief lives in `kickoff-game-brief.tsx`. Hub TabBar stays Kickoff · CAD · Code · Robot. No team selected paints HubOrgGate **Choose your team**. Setup badge is **Needs setup**. One **Ask about this game** primary on the brief. Empty keeps one primary.");
  });
});
