import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-comms. Hub labels stay Design reviews, Driver tryouts,
 * Incidents, and Meeting agenda. leftover-cad-titles Design reviews,
 * leftover-people-more Driver tryouts, leftover-build-titles Incidents,
 * leftover-fmea-strips no Open FMEA, leftover-goals-kit Meeting agenda,
 * leftover-fmea-boards extras stay. leftover-opening-comms Opening
 * Discord, leftover-opening-roles Opening Season roles,
 * leftover-opening-fmea Opening Failure log, leftover-pick-before Choose
 * your team, leftover-fmea Failure log stay. leftover-admin skip-list
 * Global Team Manager stays. leftover-my-day Loading My Day stays (hub
 * My Day). Hub Schema A/B stays. leftover-offline extras and leftover-hub
 * extras stay off these FILES. leftover-safety Safety incidents stays.
 * Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/reviews/reviews-client.tsx",
  "app/driver-tryouts/driver-tryouts-client.tsx",
  "app/incident-heatmap/incident-heatmap-client.tsx",
  "app/meeting-autopilot/meeting-autopilot-client.tsx",
] as const;

describe("leftover student opening-reviews chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
      expect(src, rel).not.toMatch(/Design Reviews/);
      expect(src, rel).not.toMatch(/Driver Tryouts/);
      expect(src, rel).not.toMatch(/Incident Heatmap/);
      expect(src, rel).not.toMatch(/Open FMEA/);
    }
    const reviews = readFileSync(join(WEB, "app/reviews/reviews-client.tsx"), "utf8");
    expect(reviews).toMatch(/Opening Design reviews/);
    expect(reviews).toMatch(/title="Design reviews"/);
    expect(reviews).toMatch(/feature="Design reviews"/);
    const tryouts = readFileSync(
      join(WEB, "app/driver-tryouts/driver-tryouts-client.tsx"),
      "utf8",
    );
    expect(tryouts).toMatch(/Opening Driver tryouts/);
    expect(tryouts).toMatch(/title="Driver tryouts"/);
    expect(tryouts).toMatch(/feature="Driver tryouts"/);
    const incidents = readFileSync(
      join(WEB, "app/incident-heatmap/incident-heatmap-client.tsx"),
      "utf8",
    );
    expect(incidents).toMatch(/Opening Incidents/);
    expect(incidents).toMatch(/title="Incidents"/);
    expect(incidents).toMatch(/feature="Incidents"/);
    expect(incidents).toMatch(/Choose your team/);
    const agenda = readFileSync(
      join(WEB, "app/meeting-autopilot/meeting-autopilot-client.tsx"),
      "utf8",
    );
    expect(agenda).toMatch(/Opening Meeting agenda/);
    expect(agenda).toMatch(/title="Meeting agenda"/);
    expect(agenda).toMatch(/feature="Meeting agenda"/);
  });
});
