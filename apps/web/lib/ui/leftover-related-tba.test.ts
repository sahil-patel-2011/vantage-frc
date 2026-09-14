import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { onboardingBuddyShellCopy } from "../onboarding-buddy/onboarding-buddy-related";
import { pitShellCopy } from "../pit";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student related-strip / calendar / logistics / video / marketing
 * chrome after the Help / Workspace TBA pass. Connect TBA stays the official
 * connector name on Strategy / Onboarding / Dossier setup. Do not invent a
 * last-snapshot.
 */
const STRICT_FILES = [
  "lib/onboarding-buddy/onboarding-buddy-related.ts",
  "lib/match-notes-timeline/match-notes-timeline-related.ts",
  "lib/match-notes-timeline/compute-match-notes-timeline.ts",
  "lib/logistics/logistics-related.ts",
  "lib/pit/pit-related.ts",
  "lib/match-delta-watcher/match-delta-watcher-related.ts",
  "lib/cross-team-scrim/cross-team-scrim-related.ts",
  "lib/event-day-plan/event-day-plan-related.ts",
  "lib/kickoff-related.ts",
  "lib/display/display-related.ts",
  "app/calendar/calendar-client.tsx",
  "app/logistics/logistics-trips.tsx",
  "app/team/security/capabilities-client.tsx",
  "lib/video-analysis/video-analysis-related.ts",
  "app/api/video-analysis/route.ts",
  "app/migrate/migrate-client.tsx",
  "components/marketing/product-glances.tsx",
  "lib/marketing/product-story.ts",
  "lib/display.ts",
] as const;

const CONNECT_TBA_FILES = [
  "app/api/strategy/route.ts",
  "lib/onboarding-workflow.ts",
  "lib/dossier/compute-dossier.ts",
] as const;

describe("leftover student related-strip TBA chrome", () => {
  it("does not print TBA, Statbotics, or The Blue Alliance on this family", () => {
    for (const rel of STRICT_FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/TBA\/Statbotics/);
      expect(src, rel).not.toMatch(/\bTBA\b/);
      expect(src, rel).not.toMatch(/Statbotics/);
      expect(src, rel).not.toMatch(/The Blue Alliance/);
      expect(src, rel).not.toMatch(/Season EPA/);
      expect(src, rel).not.toMatch(/Sync TBA/);
    }
  });

  it("Strategy / Onboarding / Dossier keep Connect TBA and drop Sync TBA", () => {
    for (const rel of CONNECT_TBA_FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/TBA\/Statbotics/);
      expect(src, rel).not.toMatch(/The Blue Alliance/);
      expect(src, rel).not.toMatch(/Season EPA/);
      expect(src, rel).not.toMatch(/Sync TBA/);
      expect(src, rel).not.toMatch(/Cache Statbotics/);
      expect(src, rel).toMatch(/Connect TBA/);
    }
  });

  it("setup stays Needs setup and student-readable", () => {
    expect(onboardingBuddyShellCopy("setup").badge).toBe("Needs setup");
    expect(pitShellCopy("setup").badge).toBe("Needs setup");
    expectPlainCopy(onboardingBuddyShellCopy("setup").description);
    expectPlainCopy(pitShellCopy("setup").description);
  });
});
