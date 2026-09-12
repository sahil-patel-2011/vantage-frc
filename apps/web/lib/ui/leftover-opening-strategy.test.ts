import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student related-strip title: "Loading…" boards after leftover
 * opening-intel. leftover-event-day-more Event day / Open Event day,
 * leftover-hub-mismatch Alliance desk, leftover-strips-more Pick list,
 * leftover-related-more Open Chemistry, leftover-pick-before Choose your
 * team, leftover-opening-intel Opening Research / Opening Briefing,
 * leftover-opening-admin Opening Global Team Manager, leftover-fmea
 * Failure log stay. leftover-admin skip-list Global Team Manager stays.
 * leftover-my-day Loading My Day stays (hub My Day). Hub Schema A/B stays.
 * Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "lib/strategy/strategy-related.ts",
  "lib/strategy/draft-related.ts",
  "lib/strategy/pick-desk-related.ts",
  "lib/chemistry/chemistry-related.ts",
] as const;

describe("leftover student opening-strategy chrome", () => {
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
    const strategy = readFileSync(join(WEB, "lib/strategy/strategy-related.ts"), "utf8");
    expect(strategy).toMatch(/Opening Strategy/);
    expect(strategy).toMatch(/Open Pick desk/);
    expect(strategy).toMatch(/Open Event day/);
    expect(strategy).toMatch(/Choose your team/);
    const draft = readFileSync(join(WEB, "lib/strategy/draft-related.ts"), "utf8");
    expect(draft).toMatch(/Opening Alliance board/);
    expect(draft).toMatch(/Open Pick desk/);
    expect(draft).toMatch(/Choose your team/);
    const desk = readFileSync(join(WEB, "lib/strategy/pick-desk-related.ts"), "utf8");
    expect(desk).toMatch(/Opening Pick desk/);
    expect(desk).toMatch(/Choose your team/);
    const chemistry = readFileSync(join(WEB, "lib/chemistry/chemistry-related.ts"), "utf8");
    expect(chemistry).toMatch(/Opening Chemistry/);
    expect(chemistry).toMatch(/Open Pick desk/);
    expect(chemistry).toMatch(/Choose your team/);
  });
});
