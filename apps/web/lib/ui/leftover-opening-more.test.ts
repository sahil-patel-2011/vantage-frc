import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * loading-more. leftover-cad-map CAD review queue, leftover-autopilot
 * Match sim, leftover-setup-vantage Match checklist, leftover-epa-boards
 * no TBA, leftover-fmea Failure log, leftover-pick-before Choose your
 * team stay. Hub My Day / Schema A/B stay. Routes stay. Do not invent a
 * last-snapshot.
 */
const FILES = [
  "app/cad-review-queue/cad-review-queue-client.tsx",
  "app/match-sim/match-sim-client.tsx",
  "app/match-checklist/match-checklist-client.tsx",
  "app/decision-critic/decision-critic-client.tsx",
] as const;

describe("leftover student opening-more chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading…"/);
      expect(src, rel).not.toMatch(/title="Loading /);
    }
    const queue = readFileSync(
      join(WEB, "app/cad-review-queue/cad-review-queue-client.tsx"),
      "utf8",
    );
    expect(queue).toMatch(/Opening CAD review queue/);
    expect(queue).toMatch(/title="CAD review queue"/);
    expect(queue).toMatch(/feature="CAD review queue"/);
    const sim = readFileSync(join(WEB, "app/match-sim/match-sim-client.tsx"), "utf8");
    expect(sim).toMatch(/Opening Match sim/);
    expect(sim).toMatch(/feature="Match sim"/);
    expect(sim).toMatch(/synced season ratings/);
    expect(sim).not.toMatch(/\bEPA\b/);
    expect(sim).not.toMatch(/\bTBA\b/);
    expect(sim).not.toMatch(/Setup required/);
    const checklist = readFileSync(
      join(WEB, "app/match-checklist/match-checklist-client.tsx"),
      "utf8",
    );
    expect(checklist).toMatch(/Opening Match checklist/);
    expect(checklist).toMatch(/feature="Match checklist"/);
    expect(checklist).not.toMatch(/Setup required/);
    const critic = readFileSync(
      join(WEB, "app/decision-critic/decision-critic-client.tsx"),
      "utf8",
    );
    expect(critic).toMatch(/Opening Decision critic/);
    expect(critic).toMatch(/title="Decision critic"/);
    expect(critic).toMatch(/Choose your team/);
  });
});
