import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-security. leftover-invites no Team admin, leftover-related-tba
 * no TBA, leftover-student-buttons no Setup required, leftover-opening
 * security Opening members, leftover-community-impact Impact,
 * leftover-fmea Failure log, leftover-pick-before Choose your team stay.
 * Hub My Day / Schema A/B stay. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/team/awards/awards-client.tsx",
  "app/reimbursements/reimbursements-client.tsx",
] as const;

describe("leftover student opening-awards chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading…"/);
      expect(src, rel).not.toMatch(/title="Loading /);
      expect(src, rel).not.toMatch(/Team admin/);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/primary-action/);
      expect(src, rel).not.toMatch(/\bTBA\b/);
    }
    const awards = readFileSync(join(WEB, "app/team/awards/awards-client.tsx"), "utf8");
    expect(awards).toMatch(/Opening Awards/);
    expect(awards).toMatch(/title="Awards"/);
    expect(awards).toMatch(/feature="Awards"/);
    expect(awards).toMatch(/Choose your team/);
    const reimbursements = readFileSync(
      join(WEB, "app/reimbursements/reimbursements-client.tsx"),
      "utf8",
    );
    expect(reimbursements).toMatch(/Opening Reimbursements/);
    expect(reimbursements).toMatch(/title="Reimbursements"/);
    expect(reimbursements).toMatch(/feature="Reimbursements"/);
  });
});
