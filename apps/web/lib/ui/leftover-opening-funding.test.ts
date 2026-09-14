import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-grants. leftover-invites no Team admin, leftover-related-tba
 * no TBA, leftover-student-buttons no Setup required, leftover-opening
 * grants Opening Grants, leftover-community-impact Impact,
 * leftover-fmea Failure log, leftover-pick-before Choose your team stay.
 * Hub My Day / Schema A/B stay. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/team/background/funding-profile-client.tsx",
  "app/connectors/connectors-client.tsx",
] as const;

describe("leftover student opening-funding chrome", () => {
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
    const funding = readFileSync(
      join(WEB, "app/team/background/funding-profile-client.tsx"),
      "utf8",
    );
    expect(funding).toMatch(/Opening Funding profile/);
    expect(funding).toMatch(/feature="Funding profile"/);
    const connectors = readFileSync(
      join(WEB, "app/connectors/connectors-client.tsx"),
      "utf8",
    );
    expect(connectors).toMatch(/Opening Connectors/);
    expect(connectors).toMatch(/title="Connectors"/);
    expect(connectors).toMatch(/feature="Connectors"/);
    expect(connectors).toMatch(/Choose your team/);
  });
});
