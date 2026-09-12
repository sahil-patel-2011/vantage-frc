import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { studentPickClockLabel } from "../picklist-justifier/pick-clock-reasons";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EPA / TBA chrome on Pick Clock stored reasons, Alliance
 * Partner Brief strengths, and Event Day capability chips. Identifiers like
 * epaTotal stay. Do not invent a last-snapshot.
 */
const FILES = [
  "lib/alliance-partner-brief/index.ts",
  "lib/command/load-command.ts",
  "app/command/command-ready-view.tsx",
  "lib/strategy/pick-clock-tag-reasons.ts",
] as const;

describe("leftover student Pick Clock / partner-brief EPA chrome", () => {
  it("does not print leftover EPA or TBA jargon on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/TBA\/Statbotics/);
      expect(src, rel).not.toMatch(/\bTBA\b/);
      expect(src, rel).not.toMatch(/Statbotics/);
      expect(src, rel).not.toMatch(/The Blue Alliance/);
      expect(src, rel).not.toMatch(/Auto EPA/);
      expect(src, rel).not.toMatch(/Endgame EPA/);
      expect(src, rel).not.toMatch(/Teleop EPA/);
      expect(src, rel).not.toMatch(/EPA total/);
    }
  });

  it("rewrites leftover stored clock labels to season ratings", () => {
    expect(studentPickClockLabel("TBA (tba): EPA 45.2")).toBe("Official record: Rating 45.2");
    expect(studentPickClockLabel("Endgame EPA 12")).toBe("Endgame rating 12");
    expect(studentPickClockLabel("TBA's official record shows an EPA of 45.2.")).toBe(
      "the official record shows a rating of 45.2.",
    );
    expect(studentPickClockLabel("Season rating 40.5")).toBe("Season rating 40.5");
  });
});
