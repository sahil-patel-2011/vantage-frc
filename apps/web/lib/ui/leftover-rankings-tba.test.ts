import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchCopilotShellCopy } from "../match-copilot/match-copilot-related";
import { picklistJustifierShellCopy } from "../picklist-justifier/picklist-justifier-related";
import { rankingsCacheRequiredCopy } from "../rankings/tba-cache";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student chrome on Rankings, Rank projection, Pick-list Justifier,
 * Match Copilot, and Shift balancer. Do not invent a last-snapshot here.
 * Identifiers like epaTotal / tbaAvailable stay.
 */
const FILES = [
  "app/rankings/rankings-client.tsx",
  "app/rankings/page.tsx",
  "app/ranking-projection/ranking-projection-client.tsx",
  "app/ranking-projection/page.tsx",
  "app/picklist-justifier/picklist-justifier-client.tsx",
  "lib/picklist-justifier/picklist-justifier-related.ts",
  "lib/picklist-justifier/index.ts",
  "app/match-copilot/match-copilot-client.tsx",
  "lib/match-copilot/match-copilot-related.ts",
  "app/shift-balancer/shift-balancer-client.tsx",
  "lib/shift-balancer/compute-shift-balancer.ts",
  "lib/alliance-partner-brief/index.ts",
] as const;

describe("leftover student Rankings / picklist TBA chrome", () => {
  it("does not print TBA, Statbotics, or Current TBA on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/TBA\/Statbotics/);
      expect(src, rel).not.toMatch(/\bTBA\b/);
      expect(src, rel).not.toMatch(/Statbotics/);
      expect(src, rel).not.toMatch(/The Blue Alliance/);
      expect(src, rel).not.toMatch(/Season EPA/);
      expect(src, rel).not.toMatch(/Current TBA/);
      expect(src, rel).not.toMatch(/opponent EPA/);
      expect(src, rel).not.toMatch(/Our EPA/);
      expect(src, rel).not.toMatch(/Highest-EPA/);
      expect(src, rel).not.toMatch(/Sync TBA/);
    }
  });

  it("setup copy stays student-readable", () => {
    expectPlainCopy(rankingsCacheRequiredCopy().description);
    expectPlainCopy(picklistJustifierShellCopy("ready").description);
    expectPlainCopy(matchCopilotShellCopy("empty").description);
    expectPlainCopy(matchCopilotShellCopy("ready").description);
  });
});
