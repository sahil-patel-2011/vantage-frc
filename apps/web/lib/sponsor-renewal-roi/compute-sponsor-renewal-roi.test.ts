import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeSponsorRenewalRiskScore, riskTierFromScore } from ".";
import { computeSponsorRenewalRoiView } from "./compute-sponsor-renewal-roi";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const SPONSOR = "22222222-2222-4222-8222-222222222222";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeSponsorRenewalRiskScore (pure)", () => {
  it("returns max risk with no linked activity, without fabricating a false 'engaged' signal", () => {
    const score = computeSponsorRenewalRiskScore({
      sponsorId: SPONSOR,
      sponsorName: "Acme Robotics",
      now: new Date("2026-07-18T00:00:00Z"),
      lastInteractionAt: null,
      interactionCount12mo: 0,
      lastContributionAt: null,
      impactMentionCount12mo: 0,
      evidenceItemCount: 0,
    });

    expect(score.noLinkedActivity).toBe(true);
    expect(score.components.interactionRecency).toBeNull();
    expect(score.components.contributionRecency).toBeNull();
    expect(score.components.evidenceCoverage).toBeNull();
    expect(score.components.showcaseViews).toBeNull();
    expect(score.score).toBe(1);
    expect(score.tier).toBe("high");
  });

  it("scores low risk for a recently and frequently engaged, well-documented sponsor", () => {
    const now = new Date("2026-07-18T00:00:00Z");
    const score = computeSponsorRenewalRiskScore({
      sponsorId: SPONSOR,
      sponsorName: "Acme Robotics",
      now,
      lastInteractionAt: new Date("2026-07-10T00:00:00Z"),
      interactionCount12mo: 8,
      lastContributionAt: new Date("2026-06-01T00:00:00Z"),
      impactMentionCount12mo: 4,
      evidenceItemCount: 4,
    });

    expect(score.noLinkedActivity).toBe(false);
    expect(score.daysSinceLastInteraction).toBe(8);
    expect(score.components.interactionRecency).not.toBeNull();
    expect(score.tier).toBe("low");
    expect(riskTierFromScore(score.score)).toBe(score.tier);
  });
});

describe("computeSponsorRenewalRoiView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeSponsorRenewalRoiView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns setup_required when the org has no sponsors on file", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM sponsors WHERE org_id")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeSponsorRenewalRoiView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBe(ORG);
    }
  });

  it("returns a live view with a per-sponsor renewal-risk score from real cross-feature signals", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM sponsors WHERE org_id")) {
        return { rows: [{ id: SPONSOR, name: "Acme Robotics", tier: "gold", status: "active" }] };
      }
      if (sql.includes("FROM sponsor_interactions")) {
        return { rows: [{ sponsorId: SPONSOR, lastInteractionAt: "2026-07-01T00:00:00.000Z", count12mo: "3" }] };
      }
      if (sql.includes("FROM sponsor_contributions")) {
        return {
          rows: [
            { sponsorId: SPONSOR, lastContributionAt: "2026-02-01T00:00:00.000Z", contributionCount: "1", totalUsd: "1000.00" },
          ],
        };
      }
      if (sql.includes("FROM sponsors s")) {
        return { rows: [{ sponsorId: SPONSOR, mentionCount: "1", evidenceCount: "1" }] };
      }
      if (sql.includes("FROM sponsor_renewal_roi_reports")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeSponsorRenewalRoiView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.sponsors).toHaveLength(1);
    const row = view.sponsors[0]!;
    expect(row.sponsorName).toBe("Acme Robotics");
    expect(row.risk.noLinkedActivity).toBe(false);
    expect(row.latestReport).toBeNull();
    expect(["low", "moderate", "high"]).toContain(row.risk.tier);
  });
});
