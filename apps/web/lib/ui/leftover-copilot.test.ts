import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Inspection Copilot / Match Copilot chrome after leftover
 * email OTP. Routes /inspection-copilot and /match-copilot and cache keys
 * stay. /match-copilot still redirects to Briefing. Do not invent a
 * last-snapshot.
 */
const FILES = [
  "app/inspection-copilot/inspection-copilot-client.tsx",
  "app/inspection-copilot/inspection-summary.tsx",
  "lib/inspection-copilot/inspection-copilot-related.ts",
  "lib/readiness-score/readiness-score-related.ts",
  "lib/readiness-score/compute-readiness-score.ts",
  "lib/robot-weigh-in/robot-weigh-in-related.ts",
  "lib/match-copilot/match-copilot-related.ts",
  "lib/match-copilot/compute-match-copilot.ts",
  "app/match-copilot/match-copilot-client.tsx",
  "app/match-copilot/page.tsx",
  "app/api/match-copilot/route.ts",
  "lib/manifests/match-copilot.manifest.ts",
  "lib/help/section-help.ts",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student Copilot chrome", () => {
  it("does not print Inspection Copilot or Match Copilot on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Inspection Copilot/);
      expect(src, rel).not.toMatch(/Match Copilot/);
      expect(src, rel).not.toMatch(/Open Inspection Copilot/);
    }
    const inspection = readFileSync(join(WEB, "app/inspection-copilot/inspection-copilot-client.tsx"), "utf8");
    expect(inspection).toMatch(/feature="Inspection"/);
    expect(inspection).toMatch(/"inspection-copilot"/);
    const match = readFileSync(join(WEB, "app/match-copilot/match-copilot-client.tsx"), "utf8");
    expect(match).toMatch(/feature="Briefing"/);
    expect(match).toMatch(/"match-copilot"/);
    const routes = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(routes).toMatch(/startsWith\("\/match-copilot"\)\) return "Briefing"/);
  });
});
