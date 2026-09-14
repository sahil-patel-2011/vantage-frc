import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student related-strip title: "Loading…" boards after leftover
 * opening-strategy. leftover-scout-more Accuracy / Cross-check /
 * Disagreements, leftover-scout-titles Coverage / Shifts, leftover-event-day-more
 * Event day, leftover-pick-before Choose your team, leftover-opening-strategy
 * Opening Strategy / Opening Alliance board, leftover-opening-intel Opening
 * Research, leftover-opening-admin Opening Global Team Manager, leftover-fmea
 * Failure log stay. leftover-admin skip-list Global Team Manager stays.
 * leftover-my-day Loading My Day stays (hub My Day). Hub Schema A/B stays.
 * Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "lib/scouting/scouting-related.ts",
  "lib/scout-accuracy/scout-accuracy-related.ts",
  "lib/scout-crossval/scout-crossval-related.ts",
  "lib/scout-disagreements/scout-disagreements-related.ts",
] as const;

describe("leftover student opening-scout chrome", () => {
  it("does not print leftover related Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
      expect(src, rel).not.toMatch(/Team admin/);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/primary-action/);
      expect(src, rel).not.toMatch(/\bTBA\b/);
      expect(src, rel).not.toMatch(/Event Day/);
    }
    const scouting = readFileSync(join(WEB, "lib/scouting/scouting-related.ts"), "utf8");
    expect(scouting).toMatch(/Opening Scouting/);
    expect(scouting).toMatch(/Open Coverage/);
    expect(scouting).toMatch(/Choose your team/);
    const accuracy = readFileSync(
      join(WEB, "lib/scout-accuracy/scout-accuracy-related.ts"),
      "utf8",
    );
    expect(accuracy).toMatch(/Opening Accuracy/);
    expect(accuracy).toMatch(/Open Scouting/);
    expect(accuracy).toMatch(/Open Coverage/);
    expect(accuracy).toMatch(/Choose your team/);
    const crossval = readFileSync(
      join(WEB, "lib/scout-crossval/scout-crossval-related.ts"),
      "utf8",
    );
    expect(crossval).toMatch(/Opening Cross-check/);
    expect(crossval).toMatch(/Open Accuracy/);
    expect(crossval).toMatch(/Open Coverage/);
    expect(crossval).toMatch(/Choose your team/);
    const disagreements = readFileSync(
      join(WEB, "lib/scout-disagreements/scout-disagreements-related.ts"),
      "utf8",
    );
    expect(disagreements).toMatch(/Opening Disagreements/);
    expect(disagreements).toMatch(/Open Accuracy/);
    expect(disagreements).toMatch(/Open Coverage/);
    expect(disagreements).toMatch(/Choose your team/);
  });
});
