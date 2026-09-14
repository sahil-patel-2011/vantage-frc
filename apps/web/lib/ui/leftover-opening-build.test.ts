import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-calc. Hub labels stay Bring-up, Subsystem specs, and Batteries.
 * leftover-opening-calc Opening Gearbox calculator, leftover-pick-before
 * Choose your team, leftover-fmea Failure log stay. leftover-admin
 * skip-list Global Team Manager stays. leftover-my-day Loading My Day
 * stays (hub My Day). Hub Schema A/B stays. Routes stay. Do not invent
 * a last-snapshot.
 */
const FILES = [
  "app/bringup/bringup-client.tsx",
  "app/subsystems/subsystems-client.tsx",
  "app/batteries/batteries-chrome.tsx",
] as const;

describe("leftover student opening-build chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
    }
    const bringup = readFileSync(join(WEB, "app/bringup/bringup-client.tsx"), "utf8");
    expect(bringup).toMatch(/Opening Bring-up/);
    expect(bringup).toMatch(/title="Bring-up"/);
    expect(bringup).toMatch(/feature="Bring-up"/);
    expect(bringup).toMatch(/Choose your team/);
    const subsystems = readFileSync(join(WEB, "app/subsystems/subsystems-client.tsx"), "utf8");
    expect(subsystems).toMatch(/Opening Subsystem specs/);
    expect(subsystems).toMatch(/title="Subsystem specs"/);
    expect(subsystems).toMatch(/feature="Subsystem specs"/);
    expect(subsystems).toMatch(/Choose your team/);
    const batteries = readFileSync(join(WEB, "app/batteries/batteries-chrome.tsx"), "utf8");
    expect(batteries).toMatch(/Opening Batteries/);
    expect(batteries).toMatch(/title="Batteries"/);
    expect(batteries).toMatch(/feature="Batteries"/);
    expect(batteries).toMatch(/Choose your team/);
  });
});
