import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { studentCompareDimensionLabel } from "./student-rating-label";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EPA / TBA chrome on Chemistry and Research boards after
 * the generator gold. Identifiers like totalEpa / epaTotal stay. Do not
 * source-scan student-rating-label.ts or intel-research analytics.
 */
const FILES = ["app/chemistry/chemistry-client.tsx", "app/intel/intel-ready-view.tsx"] as const;

describe("leftover student Chemistry / Research EPA chrome", () => {
  it("does not print leftover EPA phrases on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Need event EPA/);
      expect(src, rel).not.toMatch(/TBA\/Statbotics/);
      expect(src, rel).not.toMatch(/Season EPA/);
      expect(src, rel).not.toMatch(/of EPA/);
      expect(src, rel).not.toMatch(/missing EPA/);
      expect(src, rel).not.toMatch(/\bEPA\b/);
      expect(src, rel).toMatch(/studentRatingLabel/);
    }
  });

  it("keeps student-readable season-rating copy", () => {
    const chemistry = readFileSync(join(WEB, "app/chemistry/chemistry-client.tsx"), "utf8");
    const intel = readFileSync(join(WEB, "app/intel/intel-ready-view.tsx"), "utf8");
    expect(chemistry).toMatch(/season ratings/);
    expect(intel).toMatch(/studentCompareDimensionLabel/);
    expect(studentCompareDimensionLabel("epaTotal")).toBe("Season rating");
    expect(studentCompareDimensionLabel("epaAuto")).toBe("Auto");
    expect(studentCompareDimensionLabel("epaTeleop")).toBe("Teleop");
    expect(studentCompareDimensionLabel("epaEndgame")).toBe("Endgame");
  });
});
