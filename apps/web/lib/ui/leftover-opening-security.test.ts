import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-inbox. leftover-invites no Team admin, leftover-related-tba
 * no TBA, leftover-student-buttons no Setup required, leftover-opening
 * inbox Opening Chat, leftover-fmea Failure log, leftover-pick-before
 * Choose your team stay. Hub My Day / Schema A/B stay. Routes stay.
 * Do not invent a last-snapshot.
 */
const FILES = [
  "app/team/security/capabilities-client.tsx",
  "app/team/security/hub-access-client.tsx",
] as const;

describe("leftover student opening-security chrome", () => {
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
    const capabilities = readFileSync(
      join(WEB, "app/team/security/capabilities-client.tsx"),
      "utf8",
    );
    expect(capabilities).toMatch(/Opening members/);
    expect(capabilities).toMatch(/feature="Team security"/);
    const access = readFileSync(
      join(WEB, "app/team/security/hub-access-client.tsx"),
      "utf8",
    );
    expect(access).toMatch(/Opening hub access/);
    expect(access).toMatch(/feature="Team security"/);
  });
});
