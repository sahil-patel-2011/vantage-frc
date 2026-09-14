import { describe, expect, it } from "vitest";
import {
  ROBOTICS_STARTER_PACK,
  starterPackCursorAsk,
  starterPackRules,
  starterPackSkills,
} from "./robotics-starter-pack";

describe("robotics Cursor starter pack", () => {
  it("ships rules and skills with one Limelight and blank specs", () => {
    expect(starterPackRules().length).toBeGreaterThanOrEqual(3);
    expect(starterPackSkills().length).toBeGreaterThanOrEqual(3);
    expect(ROBOTICS_STARTER_PACK.every((item) => /^[a-z0-9-]+$/.test(item.name))).toBe(true);
    const blob = JSON.stringify(ROBOTICS_STARTER_PACK);
    expect(blob).toMatch(/one\*\* Limelight|one Limelight/);
    expect(blob).not.toMatch(/\bEPA\b/);
    expect(blob).toMatch(/Wheel diameter:/);
    expect(blob).not.toMatch(/Wheel diameter: \d/);
  });

  it("tells Cursor to add the pack and stop after a file list", () => {
    const ask = starterPackCursorAsk();
    expect(ask).toMatch(/\.cursor\/rules\/vantage/);
    expect(ask).toMatch(/\.cursor\/skills\/vantage/);
    expect(ask).toMatch(/one Limelight/);
    expect(ask).toMatch(/Self-review/);
  });
});
