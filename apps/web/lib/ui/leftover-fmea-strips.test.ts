import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Open FMEA / FMEA strip chrome after the Failure log board
 * gold. Route id `fmea` and identifiers stay. Do not invent a last-snapshot.
 */
const FILES = [
  "lib/help/section-help.ts",
  "lib/tuning-autopilot/tuning-autopilot-related.ts",
  "lib/spare-forecast/spare-forecast-related.ts",
  "lib/risk-burndown/risk-burndown-related.ts",
  "lib/retro/retro-related.ts",
  "lib/spare-robot-kit/spare-robot-kit-related.ts",
  "lib/readiness-score/readiness-score-related.ts",
  "lib/pit-repair-triage/pit-repair-triage-related.ts",
  "lib/build-burndown/build-burndown-related.ts",
  "lib/failure-patterns/failure-patterns-related.ts",
  "lib/cad-change-radar/cad-change-radar-related.ts",
  "lib/control-map/control-map-related.ts",
  "lib/subsystem-signoff/subsystem-signoff-related.ts",
  "lib/knowledge/knowledge-related.ts",
  "lib/risks/risks-related.ts",
  "lib/inspection-copilot/inspection-copilot-related.ts",
  "lib/cad/cad-related.ts",
  "lib/my-kit/compose.ts",
  "lib/meeting-autopilot/index.ts",
  "components/team-ops-nav.tsx",
  "app/spare-robot-kit/spare-robot-kit-client.tsx",
  "app/spare-forecast/spare-forecast-client.tsx",
  "app/reuse-advisor/reuse-advisor-client.tsx",
  "app/readiness-score/readiness-score-client.tsx",
  "app/risks/risks-client.tsx",
  "app/pit/pit-command-client.tsx",
  "app/failure-patterns/failure-patterns-client.tsx",
  "app/incident-heatmap/incident-heatmap-client.tsx",
  "app/pit-repair-triage/pit-repair-triage-client.tsx",
] as const;

describe("leftover student Open FMEA related-strip chrome", () => {
  it("does not print leftover Open FMEA labels on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Open FMEA/);
      expect(src, rel).not.toMatch(/label: "FMEA"/);
      expect(src, rel).not.toMatch(/Scan FMEA/);
      expect(src, rel).not.toMatch(/Log FMEA/);
      expect(src, rel).not.toMatch(/FMEA failure\(s\)/);
      expect(src, rel).not.toMatch(/prior FMEA/);
    }
  });
});
