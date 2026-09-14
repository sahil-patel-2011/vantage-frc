import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-reviews. Hub labels stay Alumni, Exit interviews, Mentor
 * hours, and Team setup. leftover-kit-titles Alumni / Equipment /
 * Safety extras, leftover-people-more Exit interviews / Mentor hours,
 * leftover-people-titles Team setup extras stay. leftover-opening-ops
 * Opening Alumni on related stays. leftover-opening-reviews Opening
 * Design reviews, leftover-opening-comms Opening Discord,
 * leftover-opening-roles Opening Season roles, leftover-opening-fmea
 * Opening Failure log, leftover-pick-before Choose your team,
 * leftover-fmea Failure log stay. leftover-admin skip-list Global Team
 * Manager stays. leftover-my-day Loading My Day stays (hub My Day). Hub
 * Schema A/B stays. leftover-offline extras and leftover-hub extras stay
 * off these FILES. leftover-safety Safety incidents stays. Routes stay.
 * Do not invent a last-snapshot.
 */
const FILES = [
  "app/alumni-network/alumni-network-client.tsx",
  "app/exit-interview/exit-interview-client.tsx",
  "app/mentor-hours/mentor-hours-client.tsx",
  "app/team/getting-started/getting-started-client.tsx",
] as const;

describe("leftover student opening-people chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
      expect(src, rel).not.toMatch(/Alumni Network/);
      expect(src, rel).not.toMatch(/Exit Interviews/);
      expect(src, rel).not.toMatch(/Mentor Hours/);
    }
    const alumni = readFileSync(
      join(WEB, "app/alumni-network/alumni-network-client.tsx"),
      "utf8",
    );
    expect(alumni).toMatch(/Opening Alumni/);
    expect(alumni).toMatch(/title="Alumni"/);
    expect(alumni).toMatch(/feature="Alumni"/);
    const exit = readFileSync(join(WEB, "app/exit-interview/exit-interview-client.tsx"), "utf8");
    expect(exit).toMatch(/Opening Exit interviews/);
    expect(exit).toMatch(/title="Exit interviews"/);
    expect(exit).toMatch(/feature="Exit interviews"/);
    const hours = readFileSync(join(WEB, "app/mentor-hours/mentor-hours-client.tsx"), "utf8");
    expect(hours).toMatch(/Opening Mentor hours/);
    expect(hours).toMatch(/title="Mentor hours"/);
    expect(hours).toMatch(/feature="Mentor hours"/);
    const setup = readFileSync(
      join(WEB, "app/team/getting-started/getting-started-client.tsx"),
      "utf8",
    );
    expect(setup).toMatch(/Opening Team setup/);
    expect(setup).toMatch(/"Team setup"/);
    expect(setup).toMatch(/feature="Team setup"/);
  });
});
