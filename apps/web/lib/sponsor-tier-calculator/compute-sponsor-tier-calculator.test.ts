import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeSponsorTierCalculatorView } from "./compute-sponsor-tier-calculator";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeSponsorTierCalculatorView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeSponsorTierCalculatorView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view matching sponsors to tiers with benefit fulfillment status", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM sponsor_tier_calculator_tiers")) {
        return {
          rows: [
            { id: "tier-bronze", name: "Bronze", minAmountUsd: "500.00", benefits: ["Newsletter shoutout"], sortOrder: 0 },
            {
              id: "tier-gold",
              name: "Gold",
              minAmountUsd: "2000.00",
              benefits: ["Logo on robot", "Banner at events"],
              sortOrder: 1,
            },
          ],
        };
      }
      if (sql.includes("FROM sponsors WHERE org_id")) {
        return { rows: [{ id: "sponsor-1", name: "Acme Robotics", tier: "silver" }] };
      }
      if (sql.includes("FROM sponsor_contributions")) {
        return { rows: [{ sponsorId: "sponsor-1", total: "2500.00" }] };
      }
      if (sql.includes("FROM sponsor_tier_calculator_fulfillments")) {
        return {
          rows: [
            {
              sponsorId: "sponsor-1",
              benefit: "Logo on robot",
              fulfilled: true,
              fulfilledAt: "2026-02-01T00:00:00.000Z",
              notes: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const view = await computeSponsorTierCalculatorView(client, {
      userId: USER,
      requestedOrg: ORG,
      seasonYear: 2026,
    });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.tiers).toHaveLength(2);
    expect(view.rows).toHaveLength(1);

    const row = view.rows[0]!;
    expect(row.sponsorName).toBe("Acme Robotics");
    expect(row.totalGivenUsd).toBe(2500);
    expect(row.calculatedTierName).toBe("Gold");
    expect(row.nextTierName).toBeNull();
    expect(row.benefits).toHaveLength(2);
    expect(row.benefits.find((b) => b.benefit === "Logo on robot")?.fulfilled).toBe(true);
    expect(row.benefits.find((b) => b.benefit === "Banner at events")?.fulfilled).toBe(false);
    expect(row.fulfilledCount).toBe(1);

    expect(view.summary.totalSponsors).toBe(1);
    expect(view.summary.totalRaisedUsd).toBe(2500);
    expect(view.summary.belowLowestTierCount).toBe(0);
    expect(view.summary.tierCounts.find((t) => t.tierName === "Gold")?.count).toBe(1);
  });
});
