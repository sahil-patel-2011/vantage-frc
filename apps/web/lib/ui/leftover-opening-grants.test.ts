import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-awards. leftover-invites no Team admin, leftover-related-tba
 * no TBA, leftover-student-buttons no Setup required, leftover-opening
 * awards Opening Awards, leftover-community-impact Impact,
 * leftover-fmea Failure log, leftover-pick-before Choose your team stay.
 * Hub My Day / Schema A/B stay. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/team/grants/grants-client.tsx",
  "app/team/grants/allocate-spend.tsx",
] as const;

describe("leftover student opening-grants chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading…"/);
      expect(src, rel).not.toMatch(/title="Loading /);
      expect(src, rel).not.toMatch(/Team admin/);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/primary-action/);
      expect(src, rel).not.toMatch(/\bTBA\b/);
      expect(src, rel).not.toMatch(/Community Impact/);
    }
    const grants = readFileSync(join(WEB, "app/team/grants/grants-client.tsx"), "utf8");
    expect(grants).toMatch(/Opening Grants/);
    expect(grants).toMatch(/Grant writing/);
    expect(grants).toMatch(/feature="Grant writing"/);
    expect(grants).toMatch(/>Impact</);
    const spend = readFileSync(join(WEB, "app/team/grants/allocate-spend.tsx"), "utf8");
    expect(spend).toMatch(/Opening spend options/);
    expect(spend).toMatch(/Open Business · Grants/);
  });
});
