import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Strategy setup wording student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Main Strategy empty/setup + next actions; **From our scouting** (scout ratings + differentials + pit pings + opponent profiles) in the same workbench — not ten extra tools; **Pick desk** is featured (`/strategy?tab=picks`): rank / pick / lock, one **Lock this list** primary, last snapshot (`feature: \"pick-desk\"`). Pick desk uses your scouting when you have 3+ matches; mentor share links on Draft / `/strategy/board` only open for this team (no “org-bound” / share-token copy); `GET /api/org/analytics/private-epa`; agent `strategy.private_edge`; win rates stay blank until stored. Setup badge is **Needs setup**. Student chrome says synced event numbers / **Sync Team Data**, not TBA/Statbotics/EPA. Draft / Pick clock / Chemistry / Alliance desk / Match strategy cards keep one EmptyState primary. No-team primary is **Choose your team**. Empty keeps one primary. Student chrome says **Needs setup**, not Setup.");
  });
});
