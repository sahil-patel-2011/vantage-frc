import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-people. Hub labels stay Engineering notebook, Checklists,
 * Goals, and Districts. leftover-community-impact extras on notebook,
 * leftover-people-titles Checklists, leftover-event-day-more no Event
 * Day, leftover-goals-kit Goals, leftover-event-day-titles Districts
 * extras stay. leftover-opening-people Opening Alumni,
 * leftover-opening-reviews Opening Design reviews, leftover-opening-comms
 * Opening Discord, leftover-pick-before Choose your team, leftover-fmea
 * Failure log stay. leftover-admin skip-list Global Team Manager stays.
 * leftover-my-day Loading My Day stays (hub My Day). Hub Schema A/B
 * stays. leftover-hub-mismatch /goals Objectives vs Goals stays off this
 * family. leftover-offline extras and leftover-hub extras stay off these
 * FILES. leftover-safety Safety incidents stays. Routes stay. Do not
 * invent a last-snapshot.
 */
const FILES = [
  "app/notebook/notebook-client.tsx",
  "app/checklist-library/checklist-library-client.tsx",
  "app/goals-tracker/goals-tracker-client.tsx",
  "app/district-advancement/district-advancement-client.tsx",
] as const;

describe("leftover student opening-notebook chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
      expect(src, rel).not.toMatch(/Community Impact/);
      expect(src, rel).not.toMatch(/Checklist Library/);
      expect(src, rel).not.toMatch(/Season Goals/);
      expect(src, rel).not.toMatch(/Event Day/);
      expect(src, rel).not.toMatch(/District Advancement/);
    }
    const notebook = readFileSync(join(WEB, "app/notebook/notebook-client.tsx"), "utf8");
    expect(notebook).toMatch(/Opening Engineering notebook/);
    expect(notebook).toMatch(/title="Engineering notebook"/);
    expect(notebook).toMatch(/feature="Engineering notebook"/);
    expect(notebook).toMatch(/Choose your team/);
    const lists = readFileSync(
      join(WEB, "app/checklist-library/checklist-library-client.tsx"),
      "utf8",
    );
    expect(lists).toMatch(/Opening Checklists/);
    expect(lists).toMatch(/title="Checklists"/);
    expect(lists).toMatch(/feature="Checklists"/);
    const goals = readFileSync(join(WEB, "app/goals-tracker/goals-tracker-client.tsx"), "utf8");
    expect(goals).toMatch(/Opening Goals/);
    expect(goals).toMatch(/title="Goals"/);
    expect(goals).toMatch(/feature="Goals"/);
    const districts = readFileSync(
      join(WEB, "app/district-advancement/district-advancement-client.tsx"),
      "utf8",
    );
    expect(districts).toMatch(/Opening Districts/);
    expect(districts).toMatch(/title="Districts"/);
    expect(districts).toMatch(/feature="Districts"/);
  });
});
