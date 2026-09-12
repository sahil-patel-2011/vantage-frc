import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Collaborative Pick List / Shift Balancer related-strip
 * titles after leftover-cards-more. leftover-strategy Pick list,
 * leftover-scout-titles Shifts, leftover-hub-mismatch Alliance desk,
 * leftover-event-day-titles Day plan / Drive-team board,
 * leftover-event-day-more Event day / Open Event day, leftover-match-more
 * Pick clock, leftover-cards-more Match cards, leftover-pick Choose your
 * team stay. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "lib/alliance-selection-desk/alliance-selection-desk-related.ts",
  "lib/event-day-plan/event-day-plan-related.ts",
] as const;

describe("leftover student strips-more chrome", () => {
  it("does not print leftover Collaborative Pick List / Shift Balancer titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Collaborative Pick List/);
      expect(src, rel).not.toMatch(/Open Collaborative Pick List/);
      expect(src, rel).not.toMatch(/Shift Balancer/);
      expect(src, rel).not.toMatch(/Open Shift Balancer/);
    }
    const desk = readFileSync(
      join(WEB, "lib/alliance-selection-desk/alliance-selection-desk-related.ts"),
      "utf8",
    );
    expect(desk).toMatch(/Opening Alliance desk/);
    expect(desk).toMatch(/Retry Alliance desk/);
    expect(desk).toMatch(/label: "Pick list"/);
    expect(desk).toMatch(/Open Pick list/);
    expect(desk).toMatch(/label: "Pick clock"/);
    expect(desk).toMatch(/Open Pick clock/);
    expect(desk).toMatch(/Choose your team/);
    expect(desk).not.toMatch(/\bPick a team\b/);
    expect(desk).not.toMatch(/Join or pick a team/);
    const day = readFileSync(
      join(WEB, "lib/event-day-plan/event-day-plan-related.ts"),
      "utf8",
    );
    expect(day).toMatch(/Opening Day plan/);
    expect(day).toMatch(/label: "Shifts"/);
    expect(day).toMatch(/Open Shifts/);
    expect(day).toMatch(/label: "Event day"/);
    expect(day).toMatch(/Open Event day/);
    expect(day).toMatch(/Open Repair triage/);
    expect(day).toMatch(/Open Charge plan/);
    expect(day).toMatch(/Choose your team/);
    expect(day).not.toMatch(/Event Day/);
    expect(day).not.toMatch(/Event-Day Plan/);
    expect(day).not.toMatch(/Event-day plan/);
    expect(day).not.toMatch(/\bPick a team\b/);
    expect(day).not.toMatch(/Join or pick a team/);
  });
});
