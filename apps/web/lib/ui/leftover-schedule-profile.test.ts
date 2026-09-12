import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scheduleCacheRequiredCopy } from "../schedule/tba-cache";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student chrome on Schedule, Team profile, Claim, scouting
 * trust/reconciliation, and strategy marketing. Do not invent a last-snapshot.
 * Team Data still names Connect TBA. Identifiers like tbaAvailable stay.
 */
const FILES = [
  "app/schedule/schedule-client.tsx",
  "lib/schedule/schedule-related.ts",
  "app/team/profile/team-profile-client.tsx",
  "app/claim/claim-client.tsx",
  "app/claim/page.tsx",
  "app/scouting/scouting-trust-panel.tsx",
  "app/scouting/scouting-reconciliation-panel.tsx",
  "app/features/strategy/page.tsx",
  "app/workflow/page.tsx",
  "app/display/setup-client.tsx",
  "app/help/help-client.tsx",
  "app/api/match-sim/route.ts",
] as const;

describe("leftover student Schedule / profile TBA chrome", () => {
  it("does not print TBA, Statbotics, or The Blue Alliance on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/TBA\/Statbotics/);
      expect(src, rel).not.toMatch(/\bTBA\b/);
      expect(src, rel).not.toMatch(/Statbotics/);
      expect(src, rel).not.toMatch(/The Blue Alliance/);
      expect(src, rel).not.toMatch(/Season EPA/);
    }
  });

  it("schedule empty copy stays student-readable", () => {
    expectPlainCopy(scheduleCacheRequiredCopy().description);
  });
});
