import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-build. Hub labels stay Auto routines, Software versions,
 * Whiteboard, and Part requests. leftover-opening-build Opening Bring-up,
 * leftover-opening-calc Opening Gearbox calculator, leftover-pick-before
 * Choose your team, leftover-fmea Failure log stay. leftover-admin
 * skip-list Global Team Manager stays. leftover-my-day Loading My Day
 * stays (hub My Day). Hub Schema A/B stays. leftover-types comments in
 * lib/whiteboard.ts stay. leftover-offline extras and leftover-hub extras
 * stay off these FILES. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/auto-routines/auto-routines-client.tsx",
  "app/software-versions/software-versions-client.tsx",
  "app/whiteboard/whiteboard-client.tsx",
  "app/whiteboard/page.tsx",
  "app/part-requests/part-requests-client.tsx",
] as const;

describe("leftover student opening-wire chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
      expect(src, rel).not.toMatch(/Strategy Whiteboard/);
    }
    const autos = readFileSync(join(WEB, "app/auto-routines/auto-routines-client.tsx"), "utf8");
    expect(autos).toMatch(/Opening Auto routines/);
    expect(autos).toMatch(/title="Auto routines"/);
    expect(autos).toMatch(/feature="Auto routines"/);
    expect(autos).toMatch(/Choose your team/);
    const versions = readFileSync(
      join(WEB, "app/software-versions/software-versions-client.tsx"),
      "utf8",
    );
    expect(versions).toMatch(/Opening Software versions/);
    expect(versions).toMatch(/title="Software versions"/);
    expect(versions).toMatch(/feature="Software versions"/);
    expect(versions).toMatch(/Choose your team/);
    const board = readFileSync(join(WEB, "app/whiteboard/whiteboard-client.tsx"), "utf8");
    expect(board).toMatch(/Opening Whiteboard/);
    expect(board).toMatch(/<h1>Whiteboard<\/h1>/);
    expect(board).toMatch(/feature="Whiteboard"/);
    expect(board).toMatch(/Choose your team/);
    const page = readFileSync(join(WEB, "app/whiteboard/page.tsx"), "utf8");
    expect(page).toMatch(/title: "Whiteboard"/);
    const parts = readFileSync(join(WEB, "app/part-requests/part-requests-client.tsx"), "utf8");
    expect(parts).toMatch(/Opening Part requests/);
    expect(parts).toMatch(/title="Part requests"/);
    expect(parts).toMatch(/feature="Part requests"/);
    expect(parts).toMatch(/Choose your team/);
  });
});
