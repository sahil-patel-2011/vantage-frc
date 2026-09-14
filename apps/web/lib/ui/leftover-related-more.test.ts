import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Title-Case Open X related-strip labels after leftover
 * fmea-hub. Hub labels stay Tool checkout, Watchlist, Spare kit, Pit
 * command, Chemistry, Rule impact, Playbook, Heat signals, Pack health,
 * and Pre-match briefing. leftover-fmea Failure log, leftover-fmea-strips
 * no Open FMEA, leftover-cards-more Match cards, leftover-strips-more Pick
 * list / Shifts, leftover-kit-titles Opening Equipment / Open Safety,
 * leftover-match-more Counter-book, leftover-pick-before Choose your team,
 * leftover-epa-rating no TBA, leftover-event-day-more Event day,
 * leftover-event-day-titles Charge plan / Drive-team board,
 * leftover-related-tba no TBA, leftover-copilot no Inspection Copilot /
 * Match Copilot, leftover-hub-strips Open Repair triage / Open Spares
 * forecast stay. Hub My Day / Schema A/B stay. Routes stay. Do not invent
 * a last-snapshot.
 */
const FILES = [
  "lib/equipment-maintenance/equipment-maintenance-related.ts",
  "app/equipment-maintenance/equipment-maintenance-client.tsx",
  "lib/counter-book/counter-book-related.ts",
  "lib/epa-trend-alerts/epa-trend-alerts-related.ts",
  "lib/epa-trend-alerts/compute-epa-trend-alerts.ts",
  "lib/intel/intel-related.ts",
  "app/intel/intel-ready-view.tsx",
  "lib/pit/pit-related.ts",
  "lib/battery-health-forecast/battery-health-forecast-related.ts",
  "lib/battery-rotation/battery-rotation-related.ts",
  "lib/battery-rotation/compute-battery-rotation.ts",
  "lib/battery/battery-related.ts",
  "lib/failure-patterns/failure-patterns-related.ts",
  "lib/bin-shelf-locator/bin-shelf-locator-related.ts",
  "lib/robot-weigh-in/robot-weigh-in-related.ts",
  "lib/sketch-to-brief/sketch-to-brief-related.ts",
  "lib/writer/writer-next-actions.ts",
  "app/briefing/page.tsx",
] as const;

describe("leftover student related-more chrome", () => {
  it("does not print leftover Title-Case Open X labels", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Open Tool Checkout/);
      expect(src, rel).not.toMatch(/Open Opponent Watchlist/);
      expect(src, rel).not.toMatch(/Open Spare Robot Kit/);
      expect(src, rel).not.toMatch(/Open Pit Command/);
      expect(src, rel).not.toMatch(/Loading Pit Command/);
      expect(src, rel).not.toMatch(/Open Alliance Chemistry/);
      expect(src, rel).not.toMatch(/Open Rule Impact/);
      expect(src, rel).not.toMatch(/Open Team Knowledge/);
      expect(src, rel).not.toMatch(/Open Scouting Heat/);
      expect(src, rel).not.toMatch(/Open Health Forecast/);
      expect(src, rel).not.toMatch(/Pre-Match Briefing/);
    }
    const equipment = readFileSync(
      join(WEB, "lib/equipment-maintenance/equipment-maintenance-related.ts"),
      "utf8",
    );
    expect(equipment).toMatch(/Opening Equipment/);
    expect(equipment).toMatch(/Open Tool checkout/);
    expect(equipment).toMatch(/Open Safety/);
    expect(equipment).toMatch(/Choose your team/);
    expect(equipment).not.toMatch(/title="Loading/);
    expect(equipment).not.toMatch(/\bPick a team\b/);
    const equipmentClient = readFileSync(
      join(WEB, "app/equipment-maintenance/equipment-maintenance-client.tsx"),
      "utf8",
    );
    expect(equipmentClient).toMatch(/Open Tool checkout/);
    expect(equipmentClient).toMatch(/title="Equipment"/);
    const counter = readFileSync(
      join(WEB, "lib/counter-book/counter-book-related.ts"),
      "utf8",
    );
    expect(counter).toMatch(/Opening Counter-book/);
    expect(counter).toMatch(/Open Watchlist/);
    expect(counter).toMatch(/Choose your team/);
    expect(counter).not.toMatch(/title="Loading/);
    expect(counter).not.toMatch(/\bPick a team\b/);
    expect(counter).not.toMatch(/\bTBA\b/);
    const epaRelated = readFileSync(
      join(WEB, "lib/epa-trend-alerts/epa-trend-alerts-related.ts"),
      "utf8",
    );
    expect(epaRelated).toMatch(/Open Watchlist/);
    expect(epaRelated).toMatch(/Open Heat signals/);
    expect(epaRelated).toMatch(/Choose your team/);
    expect(epaRelated).not.toMatch(/EPA Trend Alerts/);
    expect(epaRelated).not.toMatch(/\bTBA\b/);
    expect(epaRelated).not.toMatch(/Statbotics/);
    expect(epaRelated).not.toMatch(/\bPick a team\b/);
    const epaCompute = readFileSync(
      join(WEB, "lib/epa-trend-alerts/compute-epa-trend-alerts.ts"),
      "utf8",
    );
    expect(epaCompute).toMatch(/Open Watchlist/);
    expect(epaCompute).toMatch(/Choose your team/);
    expect(epaCompute).not.toMatch(/EPA Trend Alerts/);
    expect(epaCompute).not.toMatch(/\bTBA\b/);
    expect(epaCompute).not.toMatch(/Statbotics/);
    const intel = readFileSync(join(WEB, "lib/intel/intel-related.ts"), "utf8");
    expect(intel).toMatch(/Open Chemistry/);
    const intelReady = readFileSync(join(WEB, "app/intel/intel-ready-view.tsx"), "utf8");
    expect(intelReady).toMatch(/Open Chemistry/);
    const pit = readFileSync(join(WEB, "lib/pit/pit-related.ts"), "utf8");
    expect(pit).toMatch(/Opening Pit command/);
    expect(pit).not.toMatch(/title="Loading/);
    expect(pit).not.toMatch(/Event Day/);
    expect(pit).not.toMatch(/\bTBA\b/);
    expect(pit).not.toMatch(/Setup required/);
    const pack = readFileSync(
      join(WEB, "lib/battery-health-forecast/battery-health-forecast-related.ts"),
      "utf8",
    );
    expect(pack).toMatch(/Open Pit command/);
    const charge = readFileSync(
      join(WEB, "lib/battery-rotation/battery-rotation-related.ts"),
      "utf8",
    );
    expect(charge).toMatch(/Open Pack health/);
    expect(charge).toMatch(/Open Pit command/);
    expect(charge).toMatch(/Charge plan/);
    expect(charge).not.toMatch(/Battery Rotation/);
    const chargeCompute = readFileSync(
      join(WEB, "lib/battery-rotation/compute-battery-rotation.ts"),
      "utf8",
    );
    expect(chargeCompute).toMatch(/Open Pack health/);
    expect(chargeCompute).toMatch(/Open Pit command/);
    const battery = readFileSync(join(WEB, "lib/battery/battery-related.ts"), "utf8");
    expect(battery).toMatch(/Open Pit command/);
    const patterns = readFileSync(
      join(WEB, "lib/failure-patterns/failure-patterns-related.ts"),
      "utf8",
    );
    expect(patterns).toMatch(/Open Spare kit/);
    expect(patterns).toMatch(/Open Repair triage/);
    expect(patterns).toMatch(/Open Failure log/);
    expect(patterns).toMatch(/Choose your team/);
    expect(patterns).not.toMatch(/Open FMEA/);
    expect(patterns).not.toMatch(/\bPick a team\b/);
    const bins = readFileSync(
      join(WEB, "lib/bin-shelf-locator/bin-shelf-locator-related.ts"),
      "utf8",
    );
    expect(bins).toMatch(/Open Spare kit/);
    expect(bins).toMatch(/Open Spares forecast/);
    const weigh = readFileSync(
      join(WEB, "lib/robot-weigh-in/robot-weigh-in-related.ts"),
      "utf8",
    );
    expect(weigh).toMatch(/Open Spare kit/);
    expect(weigh).not.toMatch(/Inspection Copilot/);
    expect(weigh).not.toMatch(/Match Copilot/);
    const sketch = readFileSync(
      join(WEB, "lib/sketch-to-brief/sketch-to-brief-related.ts"),
      "utf8",
    );
    expect(sketch).toMatch(/Open Rule impact/);
    expect(sketch).toMatch(/Choose your team/);
    expect(sketch).not.toMatch(/\bPick a team\b/);
    const writer = readFileSync(join(WEB, "lib/writer/writer-next-actions.ts"), "utf8");
    expect(writer).toMatch(/Open Playbook/);
    const briefing = readFileSync(join(WEB, "app/briefing/page.tsx"), "utf8");
    expect(briefing).toMatch(/title: "Pre-match briefing"/);
  });
});
