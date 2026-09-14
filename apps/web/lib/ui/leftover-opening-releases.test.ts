import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-account. leftover-product-chrome What’s new, leftover-schema-oauth
 * no Setup required / TBA/Statbotics, leftover-opening-account Opening
 * Account, leftover-invites no Team admin, leftover-fmea Failure log,
 * leftover-pick-before Choose your team stay. Hub My Day / Schema A/B
 * stay. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/whats-new/whats-new-client.tsx",
  "app/kickoff/kickoff-intelligence.tsx",
] as const;

describe("leftover student opening-releases chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading…"/);
      expect(src, rel).not.toMatch(/title="Loading /);
      expect(src, rel).not.toMatch(/Team admin/);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/primary-action/);
      expect(src, rel).not.toMatch(/Hard cut-off/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/fetchFailed \|\| !view/);
      expect(src, rel).not.toMatch(/\bTBA\b/);
      expect(src, rel).not.toMatch(/TBA\/Statbotics/);
    }
    const releases = readFileSync(join(WEB, "app/whats-new/whats-new-client.tsx"), "utf8");
    expect(releases).toMatch(/Opening What’s new/);
    expect(releases).toMatch(/title="What’s new"/);
    expect(releases).toMatch(/feature="What’s new"/);
    const kickoff = readFileSync(join(WEB, "app/kickoff/kickoff-intelligence.tsx"), "utf8");
    expect(kickoff).toMatch(/Opening Kickoff/);
  });
});
