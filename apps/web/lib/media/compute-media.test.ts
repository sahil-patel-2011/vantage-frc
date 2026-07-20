import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeMediaView } from "./compute-media";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeMediaView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeMediaView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live empty board with zero counts — never DEMO metrics", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254, orgName: "The Cheesy Poofs" }] };
      }
      if (sql.includes("FROM media_kit_profiles")) return { rows: [] };
      if (sql.includes('AS "assetCount"')) {
        return { rows: [{ assetCount: 0, logoCount: 0, photoCount: 0 }] };
      }
      if (sql.includes("FROM media_kit_assets")) return { rows: [] };
      if (sql.includes('AS "documentCount"')) return { rows: [{ documentCount: 0 }] };
      if (sql.includes('AS "upcomingCount"')) {
        return { rows: [{ upcomingCount: 0, mediaCategoryCount: 0 }] };
      }
      if (sql.includes("FROM outreach_calendar_events")) return { rows: [] };
      if (sql.includes('AS "mediaActivityCount"')) {
        return { rows: [{ mediaActivityCount: 0, peopleReached: 0 }] };
      }
      if (sql.includes("FROM impact_activities")) return { rows: [] };
      if (sql.includes('AS "publishedEntryCount"')) {
        return { rows: [{ publishedEntryCount: 0, wallPublished: false }] };
      }
      return { rows: [] };
    });

    const view = await computeMediaView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.kit.assetCount).toBe(0);
    expect(view.kit.readinessScore).toBe(0);
    expect(view.outreach.upcomingCount).toBe(0);
    expect(view.impact.mediaActivityCount).toBe(0);
    expect(view.sponsorWall.publishedEntryCount).toBe(0);
  });

  it("fans in real kit, outreach, impact, and sponsor-wall signals", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254, orgName: "The Cheesy Poofs" }] };
      }
      if (sql.includes("FROM media_kit_profiles")) {
        return {
          rows: [
            {
              missionStatement: "Inspire STEM",
              teamBio: "Bay Area FRC team",
              foundedYear: 1999,
              achievements: ["Regional winners"],
              contactEmail: "press@example.com",
              websiteUrl: "https://example.com",
            },
          ],
        };
      }
      if (sql.includes('AS "assetCount"')) {
        return { rows: [{ assetCount: 2, logoCount: 1, photoCount: 1 }] };
      }
      if (sql.includes("FROM media_kit_assets") && sql.includes("ORDER BY")) {
        return {
          rows: [
            {
              id: "asset-1",
              kind: "logo",
              title: "Primary logo",
              url: "https://example.com/logo.png",
              description: null,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes('AS "documentCount"')) return { rows: [{ documentCount: 1 }] };
      if (sql.includes('AS "upcomingCount"')) {
        return { rows: [{ upcomingCount: 1, mediaCategoryCount: 1 }] };
      }
      if (sql.includes("FROM outreach_calendar_events") && sql.includes("ORDER BY")) {
        return {
          rows: [
            {
              id: "ev-1",
              title: "Press day",
              category: "media",
              scheduledOn: "2026-03-01",
              status: "planned",
            },
          ],
        };
      }
      if (sql.includes('AS "mediaActivityCount"')) {
        return { rows: [{ mediaActivityCount: 1, peopleReached: 40 }] };
      }
      if (sql.includes("FROM impact_activities") && sql.includes("ORDER BY")) {
        return {
          rows: [
            {
              id: "imp-1",
              title: "Local TV feature",
              category: "media",
              occurredOn: "2026-02-01",
              peopleReached: 40,
            },
          ],
        };
      }
      if (sql.includes('AS "publishedEntryCount"')) {
        return { rows: [{ publishedEntryCount: 3, wallPublished: true }] };
      }
      return { rows: [] };
    });

    const view = await computeMediaView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.kit.assetCount).toBe(2);
    expect(view.kit.logoCount).toBe(1);
    expect(view.kit.documentCount).toBe(1);
    expect(view.kit.readinessTier).toBe("ready");
    expect(view.kit.recentAssets).toHaveLength(1);
    expect(view.outreach.upcoming).toHaveLength(1);
    expect(view.impact.peopleReached).toBe(40);
    expect(view.sponsorWall.wallPublished).toBe(true);
  });
});
