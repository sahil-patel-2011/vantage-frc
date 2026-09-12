import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EPA / TBA chrome on Briefing, Match Sim, pick-list CSV,
 * Pairwise next-actions, and District advancement after the EPA-roles pass.
 * Identifiers like epaTotal / fmtEpa stay. Do not invent a last-snapshot.
 * Curated Statbotics / The Blue Alliance titles stay.
 */
const FILES = [
  "app/briefing/briefing-client.tsx",
  "app/match-sim/match-sim-client.tsx",
  "lib/picklist-collab/index.ts",
  "lib/pairwise/pairwise-next-actions.ts",
  "lib/district-trajectory-sim/compute-district-trajectory-sim.ts",
] as const;

describe("leftover student EPA boards / pick-list CSV chrome", () => {
  it("does not print leftover EPA or TBA jargon on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/\bEPA\b/);
      expect(src, rel).not.toMatch(/\bTBA\b/);
      expect(src, rel).not.toMatch(/TBA\/Statbotics/);
      expect(src, rel).not.toMatch(/Statbotics/);
      expect(src, rel).not.toMatch(/The Blue Alliance/);
      expect(src, rel).not.toMatch(/Season EPA/);
      expect(src, rel).not.toMatch(/our EPA/);
      expect(src, rel).not.toMatch(/sync EPA/);
      expect(src, rel).not.toMatch(/synced EPA/);
      expect(src, rel).not.toMatch(/Auto EPA/);
      expect(src, rel).not.toMatch(/Teleop EPA/);
    }
  });

  it("keeps student-readable season-rating copy", () => {
    const csv = readFileSync(join(WEB, "lib/picklist-collab/index.ts"), "utf8");
    const briefing = readFileSync(join(WEB, "app/briefing/briefing-client.tsx"), "utf8");
    const sim = readFileSync(join(WEB, "app/match-sim/match-sim-client.tsx"), "utf8");
    const pairwise = readFileSync(join(WEB, "lib/pairwise/pairwise-next-actions.ts"), "utf8");
    const trajectory = readFileSync(
      join(WEB, "lib/district-trajectory-sim/compute-district-trajectory-sim.ts"),
      "utf8",
    );
    const curated = readFileSync(join(WEB, "lib/ui/curated-resources.ts"), "utf8");
    expect(csv).toMatch(/"Season rating"/);
    expect(csv).toMatch(/"Auto rating"/);
    expect(briefing).toMatch(/our rating/);
    expect(briefing).toMatch(/sync season ratings/);
    expect(sim).toMatch(/synced season ratings/);
    expect(pairwise).toMatch(/official match data/);
    expect(pairwise).toMatch(/season ratings/);
    expect(trajectory).toMatch(/season-rating baseline/);
    expect(curated).toMatch(/Free season ratings/);
    expect(curated).not.toMatch(/Free EPA ratings/);
    expect(curated).toMatch(/The Blue Alliance/);
    expect(curated).toMatch(/Statbotics/);
  });
});
