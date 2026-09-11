import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eventDayPlanShellCopy } from "../event-day-plan/event-day-plan-related";
import { matchVideoIndexShellCopy } from "../match-video-index/match-video-index-related";
import { toolCheckoutShellCopy } from "../tool-checkout/tool-checkout-related";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student chrome not skip-list and not in remaining open PRs
 * (#2, #5–#7, #15–#26, #28–#29, #31–#32, #36–#37). Consent still said
 * VANTAGE / FORMS; Match Video Index / Event-Day Plan / Match checklist /
 * Tool checkout / Match Simulator still badged Setup required; Match Simulator
 * still named TBA/Statbotics in setup.
 */
const FILES = [
  "app/consent/consent-client.tsx",
  "app/match-video-index/match-video-index-client.tsx",
  "lib/match-video-index/match-video-index-related.ts",
  "app/event-day-plan/event-day-plan-client.tsx",
  "lib/event-day-plan/event-day-plan-related.ts",
  "app/match-checklist/match-checklist-client.tsx",
  "app/tool-checkout/tool-checkout-client.tsx",
  "lib/tool-checkout/tool-checkout-related.ts",
  "app/match-sim/match-sim-client.tsx",
  "lib/match-sim/compute-match-sim.ts",
] as const;

describe("leftover Setup required / VANTAGE Forms student chrome", () => {
  it("does not print leftover engineering copy on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/primary-action/);
      expect(src, rel).not.toMatch(/TBA\/Statbotics/);
      expect(src, rel).not.toMatch(/reference data/);
    }
  });

  it("setup badges and related copy stay student-readable", () => {
    expect(matchVideoIndexShellCopy("setup").badge).toBe("Needs setup");
    expect(eventDayPlanShellCopy("setup").badge).toBe("Needs setup");
    expect(toolCheckoutShellCopy("setup").badge).toBe("Needs setup");
    expectPlainCopy(matchVideoIndexShellCopy("setup").description);
    expectPlainCopy(eventDayPlanShellCopy("setup").description);
    expectPlainCopy(toolCheckoutShellCopy("setup").description);
  });
});
