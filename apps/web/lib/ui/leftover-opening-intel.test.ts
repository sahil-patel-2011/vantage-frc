import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student related-strip title: "Loading…" boards after leftover
 * opening-admin. leftover-related-more Open Chemistry / Open Watchlist /
 * Open Heat signals, leftover-copilot no Inspection Copilot / Match
 * Copilot / Open Event day / Open Failure log, leftover-epa-rating no TBA,
 * leftover-pick-before Choose your team, leftover-opening-admin Opening
 * Global Team Manager, leftover-fmea Failure log stay. leftover-my-day
 * Loading My Day stays (hub My Day). Hub Schema A/B stays. Routes stay.
 * Do not invent a last-snapshot.
 */
const FILES = [
  "lib/intel/intel-related.ts",
  "lib/match-copilot/match-copilot-related.ts",
  "lib/epa-trend-alerts/epa-trend-alerts-related.ts",
] as const;

describe("leftover student opening-intel chrome", () => {
  it("does not print leftover related Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
      expect(src, rel).not.toMatch(/Team admin/);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/primary-action/);
      expect(src, rel).not.toMatch(/\bTBA\b/);
      expect(src, rel).not.toMatch(/Inspection Copilot/);
      expect(src, rel).not.toMatch(/Match Copilot/);
    }
    const intel = readFileSync(join(WEB, "lib/intel/intel-related.ts"), "utf8");
    expect(intel).toMatch(/Opening Research/);
    expect(intel).toMatch(/Open Chemistry/);
    expect(intel).toMatch(/Choose your team/);
    const briefing = readFileSync(
      join(WEB, "lib/match-copilot/match-copilot-related.ts"),
      "utf8",
    );
    expect(briefing).toMatch(/Opening Briefing/);
    expect(briefing).toMatch(/Open Event day/);
    expect(briefing).toMatch(/Open Failure log/);
    expect(briefing).toMatch(/Choose your team/);
    const alerts = readFileSync(
      join(WEB, "lib/epa-trend-alerts/epa-trend-alerts-related.ts"),
      "utf8",
    );
    expect(alerts).toMatch(/Opening Rating alerts/);
    expect(alerts).toMatch(/Open Watchlist/);
    expect(alerts).toMatch(/Open Heat signals/);
    expect(alerts).toMatch(/Choose your team/);
    expect(alerts).toMatch(/Needs setup/);
  });
});
