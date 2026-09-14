import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { epaTrendAlertsShellCopy } from "../epa-trend-alerts/epa-trend-alerts-related";
import { opponentWatchlistShellCopy } from "../opponent-watchlist/opponent-watchlist-related";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student chrome that still named EPA Trend Alerts / TBA after the
 * dossier TBA pass. Do not invent a last-snapshot here. Identifiers like
 * previousEpa / epa-trend-alerts stay.
 */
const FILES = [
  "lib/epa-trend-alerts/epa-trend-alerts-related.ts",
  "lib/epa-trend-alerts/compute-epa-trend-alerts.ts",
  "app/epa-trend-alerts/epa-trend-alerts-client.tsx",
  "app/epa-trend-alerts/page.tsx",
  "app/api/epa-trend-alerts/route.ts",
  "lib/opponent-watchlist/opponent-watchlist-related.ts",
  "lib/opponent-watchlist/compute-opponent-watchlist.ts",
  "lib/opponent-watchlist/index.ts",
  "app/opponent-watchlist/opponent-watchlist-client.tsx",
  "app/display/kiosk/kiosk-client.tsx",
  "lib/manifests/epa-trend-alerts.manifest.ts",
] as const;

describe("leftover student EPA / Rating alerts chrome", () => {
  it("does not print EPA Trend Alerts, EPA alerts, or TBA on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/EPA Trend Alerts/);
      expect(src, rel).not.toMatch(/reference EPA/);
      expect(src, rel).not.toMatch(/Open EPA/);
      expect(src, rel).not.toMatch(/\bEPA alerts\b/);
      expect(src, rel).not.toMatch(/\bEPA swings\b/);
      expect(src, rel).not.toMatch(/TBA\/Statbotics/);
      expect(src, rel).not.toMatch(/\bTBA\b/);
      expect(src, rel).not.toMatch(/Statbotics/);
      expect(src, rel).not.toMatch(/The Blue Alliance/);
      expect(src, rel).not.toMatch(/Season EPA/);
    }
  });

  it("setup stays Needs setup and student-readable", () => {
    expect(epaTrendAlertsShellCopy("setup").badge).toBe("Needs setup");
    expect(opponentWatchlistShellCopy("setup").badge).toBe("Needs setup");
    expectPlainCopy(epaTrendAlertsShellCopy("setup").description);
    expectPlainCopy(epaTrendAlertsShellCopy("empty").description);
    expectPlainCopy(epaTrendAlertsShellCopy("ready").description);
    expectPlainCopy(opponentWatchlistShellCopy("setup").description);
    expectPlainCopy(opponentWatchlistShellCopy("empty").description);
  });
});
