import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Tuning Autopilot / Match Simulator / Meeting Autopilot
 * chrome after leftover-code-coach. Hub labels stay Tuning advisor,
 * Match sim, and Meeting agenda. Routes /tuning-autopilot, /match-sim,
 * and /meeting-autopilot stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/tuning-autopilot/tuning-autopilot-client.tsx",
  "app/tuning-autopilot/page.tsx",
  "app/api/tuning-autopilot/route.ts",
  "lib/tuning-autopilot/tuning-autopilot-related.ts",
  "lib/manifests/tuning-autopilot.manifest.ts",
  "app/match-sim/match-sim-client.tsx",
  "app/match-sim/page.tsx",
  "lib/manifests/match-sim.manifest.ts",
  "lib/knowledge-gap/knowledge-gap-related.ts",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student Autopilot / Simulator chrome", () => {
  it("does not print Autopilot or Match Simulator on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Tuning Autopilot/);
      expect(src, rel).not.toMatch(/tuning autopilot/i);
      expect(src, rel).not.toMatch(/Meeting Autopilot/);
      expect(src, rel).not.toMatch(/Match Simulator/);
    }
    const tuning = readFileSync(join(WEB, "app/tuning-autopilot/tuning-autopilot-client.tsx"), "utf8");
    expect(tuning).toMatch(/feature="Tuning advisor"/);
    expect(tuning).toMatch(/"tuning-autopilot"/);
    const sim = readFileSync(join(WEB, "app/match-sim/match-sim-client.tsx"), "utf8");
    expect(sim).toMatch(/feature="Match sim"/);
    expect(sim).toMatch(/"match-sim"/);
  });
});
