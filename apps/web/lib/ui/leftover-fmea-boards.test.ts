import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student FMEA chrome on Get unstuck, board descriptions, Event Day
 * pit flags, and marketing after the Open FMEA strip gold. Route id `fmea`
 * stays. Do not invent a last-snapshot.
 */
const FILES = [
  "app/readiness-score/readiness-score-client.tsx",
  "app/tuning-autopilot/tuning-autopilot-client.tsx",
  "app/risk-burndown/risk-burndown-client.tsx",
  "app/retro/retro-client.tsx",
  "app/cad-change-radar/cad-change-radar-client.tsx",
  "app/control-map/control-map-client.tsx",
  "app/build-burndown/build-burndown-client.tsx",
  "app/inspection-copilot/inspection-copilot-client.tsx",
  "app/meeting-autopilot/meeting-autopilot-client.tsx",
  "app/for-teams/page.tsx",
  "lib/troubleshoot/compute-troubleshoot.ts",
  "lib/troubleshoot/symptom-tree.ts",
  "lib/marketing/product-story.ts",
  "lib/command/pit-flags.ts",
] as const;

describe("leftover student FMEA board and Get unstuck chrome", () => {
  it("does not print leftover FMEA phrases on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Robot › FMEA/);
      expect(src, rel).not.toMatch(/Your FMEA/);
      expect(src, rel).not.toMatch(/FMEA log/);
      expect(src, rel).not.toMatch(/open FMEA/);
      expect(src, rel).not.toMatch(/FMEA clearance/);
      expect(src, rel).not.toMatch(/, FMEA,/);
      expect(src, rel).not.toMatch(/ and FMEA/);
    }
    const unstuck = readFileSync(join(WEB, "lib/troubleshoot/compute-troubleshoot.ts"), "utf8");
    expect(unstuck).toMatch(/Your Failure log/);
    const story = readFileSync(join(WEB, "lib/marketing/product-story.ts"), "utf8");
    expect(story).toMatch(/Failure log/);
  });
});
