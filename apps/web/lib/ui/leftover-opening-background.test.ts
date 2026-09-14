import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-cad-setup. Hub / leftover-offline labels stay Team background,
 * CAN-bus map, Season budget, and Forms. leftover-invites extras,
 * leftover-opening-ops Opening Forms on form-builder stay.
 * leftover-opening-cad-setup Opening CAD setup, leftover-opening-rank
 * Opening Rank projection, leftover-opening-debrief Opening Kickoff,
 * leftover-pick-before Choose your team, leftover-fmea Failure log stay.
 * leftover-admin skip-list Global Team Manager stays. leftover-my-day
 * Loading My Day stays (hub My Day). Hub Schema A/B stays.
 * leftover-offline extras and leftover-hub extras stay off these FILES.
 * leftover-safety Safety incidents stays. Routes stay. Do not invent a
 * last-snapshot.
 */
const FILES = [
  "app/team/background/background-client.tsx",
  "app/wiring/wiring-client.tsx",
  "app/budget/budget-client.tsx",
  "app/forms/forms-client.tsx",
] as const;

describe("leftover student opening-background chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
      expect(src, rel).not.toMatch(/Team admin/);
      expect(src, rel).not.toMatch(/Wiring Map/);
      expect(src, rel).not.toMatch(/Season Budget/);
    }
    const background = readFileSync(
      join(WEB, "app/team/background/background-client.tsx"),
      "utf8",
    );
    expect(background).toMatch(/Opening Team background/);
    expect(background).toMatch(/"Team background"/);
    expect(background).toMatch(/feature="Team background"/);
    const wiring = readFileSync(join(WEB, "app/wiring/wiring-client.tsx"), "utf8");
    expect(wiring).toMatch(/Opening CAN-bus map/);
    expect(wiring).toMatch(/title="CAN-bus map"/);
    expect(wiring).toMatch(/feature="CAN-bus map"/);
    const budget = readFileSync(join(WEB, "app/budget/budget-client.tsx"), "utf8");
    expect(budget).toMatch(/Opening Season budget/);
    expect(budget).toMatch(/title="Season budget"/);
    expect(budget).toMatch(/feature="Season budget"/);
    const forms = readFileSync(join(WEB, "app/forms/forms-client.tsx"), "utf8");
    expect(forms).toMatch(/Opening Forms/);
    expect(forms).toMatch(/title="Forms"/);
    expect(forms).toMatch(/feature="Forms"/);
  });
});
