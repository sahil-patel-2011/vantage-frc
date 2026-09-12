import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-consumables. Opening titles use leftover-hub labels Blueprint,
 * Objectives, Training, Packages, and People. leftover-offline Robot /
 * Goals / Scout training mode / Sponsorship / Attendance extras stay off
 * these FILES. leftover-hub extras stay off these FILES.
 * leftover-fmea-boards extras, leftover-org-bound extras stay.
 * leftover-opening-notebook leftover-hub-mismatch /goals Objectives vs
 * Goals stays. leftover-opening-consumables Opening Consumables,
 * leftover-opening-background Opening Team background, leftover-pick-before
 * Choose your team, leftover-fmea Failure log stay. leftover-admin
 * skip-list Global Team Manager stays. leftover-my-day Loading My Day
 * stays (hub My Day). Hub Schema A/B stays. leftover-safety Safety
 * incidents stays. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/robot/robot-client.tsx",
  "app/goals/goals-client.tsx",
  "app/scout-training-mode/scout-training-mode-client.tsx",
  "app/sponsorship/sponsorship-client.tsx",
  "app/attendance/attendance-client.tsx",
] as const;

describe("leftover student opening-mismatch chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
      expect(src, rel).not.toMatch(/Robot Blueprint/);
      expect(src, rel).not.toMatch(/Sponsorship one-pagers/);
      expect(src, rel).not.toMatch(/open FMEA/);
      expect(src, rel).not.toMatch(/org-bound/i);
    }
    const robot = readFileSync(join(WEB, "app/robot/robot-client.tsx"), "utf8");
    expect(robot).toMatch(/Opening Blueprint/);
    expect(robot).toMatch(/<h1>Blueprint<\/h1>/);
    expect(robot).toMatch(/feature="Robot"/);
    const goals = readFileSync(join(WEB, "app/goals/goals-client.tsx"), "utf8");
    expect(goals).toMatch(/Opening Objectives/);
    expect(goals).toMatch(/title="Goals"/);
    expect(goals).toMatch(/feature="Goals"/);
    const training = readFileSync(
      join(WEB, "app/scout-training-mode/scout-training-mode-client.tsx"),
      "utf8",
    );
    expect(training).toMatch(/Opening Training/);
    expect(training).toMatch(/title="Scout training mode"/);
    expect(training).toMatch(/feature="Scout training mode"/);
    const packages = readFileSync(join(WEB, "app/sponsorship/sponsorship-client.tsx"), "utf8");
    expect(packages).toMatch(/Opening Packages/);
    expect(packages).toMatch(/title="Packages"/);
    expect(packages).toMatch(/feature="Sponsorship"/);
    const people = readFileSync(join(WEB, "app/attendance/attendance-client.tsx"), "utf8");
    expect(people).toMatch(/Opening People/);
    expect(people).toMatch(/title="Attendance"/);
    expect(people).toMatch(/feature="Attendance"/);
  });
});
