import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-wire. Hub labels stay Recognition, Season roadmap, Your path,
 * and Subteam progress. leftover-opening-wire Opening Auto routines,
 * leftover-opening-build Opening Bring-up, leftover-opening-calc Opening
 * Gearbox calculator, leftover-pick-before Choose your team, leftover-fmea
 * Failure log stay. leftover-admin skip-list Global Team Manager stays.
 * leftover-my-day Loading My Day stays (hub My Day). Hub Schema A/B stays.
 * leftover-offline extras and leftover-hub extras stay off these FILES.
 * Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/recognition/recognition-client.tsx",
  "app/roadmap/roadmap-client.tsx",
  "app/start/start-client.tsx",
  "app/subteams/subteams-client.tsx",
] as const;

describe("leftover student opening-path chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
    }
    const awards = readFileSync(join(WEB, "app/recognition/recognition-client.tsx"), "utf8");
    expect(awards).toMatch(/Opening Recognition/);
    expect(awards).toMatch(/title="Recognition"/);
    expect(awards).toMatch(/feature="Recognition"/);
    expect(awards).toMatch(/Choose your team/);
    const roadmap = readFileSync(join(WEB, "app/roadmap/roadmap-client.tsx"), "utf8");
    expect(roadmap).toMatch(/Opening Season roadmap/);
    expect(roadmap).toMatch(/title="Season roadmap"/);
    expect(roadmap).toMatch(/feature="Season roadmap"/);
    const path = readFileSync(join(WEB, "app/start/start-client.tsx"), "utf8");
    expect(path).toMatch(/Opening Your path/);
    expect(path).toMatch(/title="Your path"/);
    expect(path).toMatch(/feature="Your path"/);
    expect(path).toMatch(/Choose your team/);
    expect(path).not.toMatch(/Loading onboarding/);
    const subteams = readFileSync(join(WEB, "app/subteams/subteams-client.tsx"), "utf8");
    expect(subteams).toMatch(/Opening Subteam progress/);
    expect(subteams).toMatch(/title="Subteam progress"/);
    expect(subteams).toMatch(/feature="Subteam progress"/);
  });
});
