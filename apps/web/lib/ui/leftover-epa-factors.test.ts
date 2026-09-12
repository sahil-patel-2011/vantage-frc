import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { studentPickClockLabel } from "../picklist-justifier/pick-clock-reasons";
import { studentRatingLabel, studentSourceLabel } from "./student-rating-label";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EPA / TBA chrome on Event Day, Strategy, Briefing factors,
 * Home prediction chips, Pit TV factors, Dossier cards, and district metadata
 * after the Pick Clock rewrite. Identifiers like epaTotal stay. Do not invent
 * a last-snapshot. Connect TBA stays off this family.
 */
const FILES = [
  "app/command/command-ready-view.tsx",
  "app/strategy/strategy-live-panel.tsx",
  "app/briefing/briefing-client.tsx",
  "app/dashboard/widgets/ops-cards.tsx",
  "app/display/kiosk/kiosk-client.tsx",
  "app/dossier/dossier-client.tsx",
  "app/district-advancement/page.tsx",
  "lib/manifests/overnight-intel.manifest.ts",
  "lib/manifests/match-copilot.manifest.ts",
] as const;

describe("leftover student prediction / Event Day EPA chrome", () => {
  it("does not print leftover EPA or TBA jargon on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/TBA\/Statbotics/);
      expect(src, rel).not.toMatch(/\bTBA\b/);
      expect(src, rel).not.toMatch(/Statbotics/);
      expect(src, rel).not.toMatch(/The Blue Alliance/);
      expect(src, rel).not.toMatch(/\bEPA\b/);
      expect(src, rel).not.toMatch(/Season EPA/);
      expect(src, rel).not.toMatch(/EPA edge/);
      expect(src, rel).not.toMatch(/EPA drift/);
      expect(src, rel).not.toMatch(/EPA movers/);
      expect(src, rel).not.toMatch(/scouting\/EPA/);
      expect(src, rel).not.toMatch(/cached EPA/);
      expect(src, rel).not.toMatch(/Rank and EPA/);
      expect(src, rel).not.toMatch(/source \?\? "reference"/);
    }
  });

  it("keeps student-readable season-rating copy", () => {
    const command = readFileSync(join(WEB, "app/command/command-ready-view.tsx"), "utf8");
    const strategy = readFileSync(join(WEB, "app/strategy/strategy-live-panel.tsx"), "utf8");
    const briefing = readFileSync(join(WEB, "app/briefing/briefing-client.tsx"), "utf8");
    const dossier = readFileSync(join(WEB, "app/dossier/dossier-client.tsx"), "utf8");
    const district = readFileSync(join(WEB, "app/district-advancement/page.tsx"), "utf8");
    expect(command).toMatch(/studentRatingLabel/);
    expect(command).toMatch(/studentSourceLabel/);
    expect(command).toMatch(/season rating/);
    expect(strategy).toMatch(/studentRatingLabel/);
    expect(briefing).toMatch(/studentRatingLabel/);
    expect(dossier).toMatch(/studentSourceLabel/);
    expect(district).toMatch(/cached season ratings/);
  });

  it("rewrites leftover prediction and source labels", () => {
    expect(studentSourceLabel("tba")).toBe("Official matches");
    expect(studentSourceLabel("statbotics")).toBe("Season ratings");
    expect(studentSourceLabel("reference")).toBe("Official matches");
    expect(studentSourceLabel("scout")).toBe("Scout notes");
    expect(studentRatingLabel("EPA edge")).toBe("Rating edge");
    expect(studentRatingLabel("EPA drift frc254")).toBe("Rating drift frc254");
    expect(studentRatingLabel("TBA+scout trust blend")).toBe("Official + scout blend");
    expect(studentRatingLabel("MODEL output — not an official TBA result.")).toBe(
      "not an official match result.",
    );
    expect(studentRatingLabel("2024 season EPA")).toBe("2024 Season rating");
    expect(studentRatingLabel("EPA 45.2")).toBe("Rating 45.2");
    expect(studentRatingLabel("Alliance EPA totals (event metrics): red 90 vs blue 80.")).toBe(
      "Alliance rating totals (event metrics): red 90 vs blue 80.",
    );
    expect(studentRatingLabel("auto EPA is 30% of total")).toBe("Auto rating is 30% of total");
    expect(studentPickClockLabel("TBA (tba): EPA 45.2")).toBe("Official record: Rating 45.2");
  });
});
