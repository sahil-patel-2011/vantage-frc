import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * manifest-titles. Hub labels stay Gearbox calculator, Power budget,
 * Shooter table, and Weight budget. leftover-learning-shot Learning,
 * leftover-schema-oauth no Setup required / TBA/Statbotics,
 * leftover-pick-before Choose your team, leftover-fmea Failure log stay.
 * leftover-admin skip-list Global Team Manager stays. leftover-my-day
 * Loading My Day stays (hub My Day). Hub Schema A/B stays. Routes stay.
 * Do not invent a last-snapshot.
 */
const FILES = [
  "app/gearbox/gearbox-client.tsx",
  "app/power-budget/power-budget-client.tsx",
  "app/shooter-table/shooter-table-client.tsx",
  "app/weight-budget/weight-budget-client.tsx",
] as const;

describe("leftover student opening-calc chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
    }
    const gearbox = readFileSync(join(WEB, "app/gearbox/gearbox-client.tsx"), "utf8");
    expect(gearbox).toMatch(/Opening Gearbox calculator/);
    expect(gearbox).toMatch(/title="Gearbox calculator"/);
    expect(gearbox).toMatch(/feature="Gearbox calculator"/);
    expect(gearbox).toMatch(/Choose your team/);
    const power = readFileSync(join(WEB, "app/power-budget/power-budget-client.tsx"), "utf8");
    expect(power).toMatch(/Opening Power budget/);
    expect(power).toMatch(/title="Power budget"/);
    expect(power).toMatch(/feature="Power budget"/);
    expect(power).toMatch(/Choose your team/);
    const shooter = readFileSync(join(WEB, "app/shooter-table/shooter-table-client.tsx"), "utf8");
    expect(shooter).toMatch(/Opening Shooter table/);
    expect(shooter).toMatch(/title="Shooter table"/);
    expect(shooter).toMatch(/feature="Shooter table"/);
    expect(shooter).toMatch(/Choose your team/);
    const weight = readFileSync(join(WEB, "app/weight-budget/weight-budget-client.tsx"), "utf8");
    expect(weight).toMatch(/Opening Weight budget/);
    expect(weight).toMatch(/title="Weight budget"/);
    expect(weight).toMatch(/feature="Weight budget"/);
    expect(weight).toMatch(/Choose your team/);
  });
});
