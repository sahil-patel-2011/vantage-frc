import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student related-strip titles after leftover-hub-mismatch.
 * Hub labels stay Spares forecast, Impact essay, Alliance desk, Repair
 * triage, Media kit, and Readiness. Routes stay. Do not invent a
 * last-snapshot.
 */
const FILES = [
  "lib/judge-sim/judge-sim-related.ts",
  "app/judge-sim/judge-sim-client.tsx",
  "lib/judge-sim/compute-judge-sim.ts",
  "lib/award-tracker/award-tracker-related.ts",
  "app/award-tracker/award-tracker-client.tsx",
  "lib/vendor-lead-times/vendor-lead-times-related.ts",
  "lib/vendor-lead-times/compute-vendor-lead-times.ts",
  "app/vendor-lead-times/vendor-lead-times-client.tsx",
  "lib/vendors/vendors-related.ts",
  "lib/failure-patterns/failure-patterns-related.ts",
  "lib/event-day-plan/event-day-plan-related.ts",
  "lib/picklist-collab/picklist-collab-related.ts",
  "lib/inventory/inventory-related.ts",
  "app/inventory/inventory-chrome.tsx",
  "lib/bin-shelf-locator/bin-shelf-locator-related.ts",
  "app/bin-shelf-locator/bin-shelf-locator-client.tsx",
  "lib/sponsor-suite/sponsor-suite-related.ts",
  "lib/media/media-related.ts",
  "app/media/media-client.tsx",
  "app/media/media-panels.tsx",
  "lib/outreach-calendar/outreach-calendar-related.ts",
  "lib/code-deploy-log/code-deploy-log-related.ts",
  "lib/robot-weigh-in/robot-weigh-in-related.ts",
] as const;

describe("leftover student hub-strip chrome", () => {
  it("does not print leftover Forecast / Essay / Desk / Triage strip titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Spare Forecast/);
      expect(src, rel).not.toMatch(/Impact Essay/);
      expect(src, rel).not.toMatch(/Alliance Selection Desk/);
      expect(src, rel).not.toMatch(/Pit Repair Triage/);
      expect(src, rel).not.toMatch(/Open Readiness Score/);
      expect(src, rel).not.toMatch(/Readiness Score/);
      expect(src, rel).not.toMatch(/Media Kit/);
    }
    const judge = readFileSync(join(WEB, "lib/judge-sim/judge-sim-related.ts"), "utf8");
    expect(judge).toMatch(/Open Impact essay/);
    const spare = readFileSync(join(WEB, "lib/vendor-lead-times/vendor-lead-times-related.ts"), "utf8");
    expect(spare).toMatch(/Open Spares forecast/);
    const repair = readFileSync(join(WEB, "lib/failure-patterns/failure-patterns-related.ts"), "utf8");
    expect(repair).toMatch(/Open Repair triage/);
    const desk = readFileSync(join(WEB, "lib/picklist-collab/picklist-collab-related.ts"), "utf8");
    expect(desk).toMatch(/Open Alliance desk/);
    const media = readFileSync(join(WEB, "lib/media/media-related.ts"), "utf8");
    expect(media).toMatch(/Open Media kit/);
    const readiness = readFileSync(join(WEB, "lib/code-deploy-log/code-deploy-log-related.ts"), "utf8");
    expect(readiness).toMatch(/Open Readiness/);
  });
});
