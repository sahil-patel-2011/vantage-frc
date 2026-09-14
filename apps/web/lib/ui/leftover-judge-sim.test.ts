import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Judge-Pitch Simulator chrome after leftover-pick-which.
 * Hub label stays Judge pitch. Route /judge-sim and cache key stay.
 * Do not invent a last-snapshot.
 */
const FILES = [
  "app/judge-sim/judge-sim-client.tsx",
  "app/judge-sim/page.tsx",
  "app/api/judge-sim/route.ts",
  "lib/judge-sim/judge-sim-related.ts",
  "lib/judge-sim/compute-judge-sim.ts",
  "lib/manifests/judge-sim.manifest.ts",
  "lib/offline/shell-routes.ts",
  "lib/award-tracker/award-tracker-related.ts",
  "lib/impact-essay/impact-essay-related.ts",
] as const;

describe("leftover student Judge-Pitch Simulator chrome", () => {
  it("does not print Judge-Pitch Simulator on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Judge-Pitch Simulator/);
      expect(src, rel).not.toMatch(/judge-pitch simulator/i);
      expect(src, rel).not.toMatch(/Judge-Pitch/);
    }
    const client = readFileSync(join(WEB, "app/judge-sim/judge-sim-client.tsx"), "utf8");
    expect(client).toMatch(/feature="Judge pitch"/);
    expect(client).toMatch(/"judge-sim"/);
    const page = readFileSync(join(WEB, "app/judge-sim/page.tsx"), "utf8");
    expect(page).toMatch(/title: "Judge pitch"/);
  });
});
