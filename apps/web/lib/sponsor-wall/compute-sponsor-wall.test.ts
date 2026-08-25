import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeSponsorWallView } from "./compute-sponsor-wall";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeSponsorWallView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeSponsorWallView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with sorted entries, settings, and a tier summary", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM sponsor_wall_entries")) {
        return {
          rows: [
            {
              id: "entry-1",
              sponsorName: "Bolt Supply",
              tier: "silver",
              logoUrl: null,
              websiteUrl: null,
              message: "Thanks for the fasteners!",
              displayOrder: 0,
              published: true,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
            {
              id: "entry-2",
              sponsorName: "Acme Robotics",
              tier: "title",
              logoUrl: "https://example.com/logo.png",
              websiteUrl: "https://example.com",
              message: "Our founding sponsor.",
              displayOrder: 0,
              published: true,
              createdAt: "2026-01-02T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM sponsor_wall_settings")) {
        return {
          rows: [
            {
              headline: "Our 2026 Sponsors",
              subtitle: "Thank you!",
              theme: "team",
              published: true,
              publicId: "33333333-3333-4333-8333-333333333333",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const view = await computeSponsorWallView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.orgId).toBe(ORG);
    expect(view.teamNumber).toBe(254);
    expect(view.settings.headline).toBe("Our 2026 Sponsors");
    expect(view.settings.theme).toBe("team");
    // The saved wall exposes its public share token for /sponsor-wall/{publicId}.
    expect(view.publicId).toBe("33333333-3333-4333-8333-333333333333");
    // Title tier should be sorted ahead of silver regardless of insertion order.
    expect(view.entries[0]?.sponsorName).toBe("Acme Robotics");
    expect(view.entries[1]?.sponsorName).toBe("Bolt Supply");
    expect(view.summary.totalEntries).toBe(2);
    expect(view.summary.publishedEntries).toBe(2);
    expect(view.summary.byTier.find((t) => t.tier === "title")?.count).toBe(1);
  });

  it("falls back to default settings when none have been saved yet", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: null }] };
      }
      if (sql.includes("FROM sponsor_wall_entries")) return { rows: [] };
      if (sql.includes("FROM sponsor_wall_settings")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeSponsorWallView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.settings.published).toBe(false);
    expect(view.settings.headline).toBe("Thank You to Our Sponsors");
    // No settings row yet means no public share token — never a fabricated link.
    expect(view.publicId).toBeNull();
    expect(view.summary.totalEntries).toBe(0);
  });
});
