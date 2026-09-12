import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover platform EmptyState title="Loading…" boards after leftover
 * opening-related. leftover-admin Global Team Manager stays skip-list.
 * leftover-invites no Team admin, leftover-opening-related Opening GitHub,
 * leftover-fmea Failure log, leftover-pick-before Choose your team stay.
 * Hub My Day / Schema A/B stay. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/admin/waitlist/waitlist-client.tsx",
  "app/admin/partners/partners-client.tsx",
  "app/admin/admin-client.tsx",
  "app/admin/support/support-client.tsx",
  "app/admin/outreach/outreach-client.tsx",
  "app/admin/analytics/analytics-client.tsx",
] as const;

describe("leftover platform opening-admin chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading…"/);
      expect(src, rel).not.toMatch(/title="Loading /);
      expect(src, rel).not.toMatch(/Team admin/);
    }
    const admin = readFileSync(join(WEB, "app/admin/admin-client.tsx"), "utf8");
    expect(admin).toMatch(/Opening Global Team Manager/);
    expect(admin).toMatch(/title="Global Team Manager"/);
    const waitlist = readFileSync(join(WEB, "app/admin/waitlist/waitlist-client.tsx"), "utf8");
    expect(waitlist).toMatch(/Opening Waitlist/);
    expect(waitlist).toMatch(/title="Waitlist"/);
    const partners = readFileSync(join(WEB, "app/admin/partners/partners-client.tsx"), "utf8");
    expect(partners).toMatch(/Opening partners/);
    const tickets = readFileSync(join(WEB, "app/admin/support/support-client.tsx"), "utf8");
    expect(tickets).toMatch(/Opening tickets/);
    const outreach = readFileSync(join(WEB, "app/admin/outreach/outreach-client.tsx"), "utf8");
    expect(outreach).toMatch(/Opening outreach/);
    const analytics = readFileSync(join(WEB, "app/admin/analytics/analytics-client.tsx"), "utf8");
    expect(analytics).toMatch(/Opening Platform analytics/);
    expect(analytics).toMatch(/title="Platform analytics"/);
  });
});
