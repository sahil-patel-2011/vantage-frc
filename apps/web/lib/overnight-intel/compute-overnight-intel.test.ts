import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeOvernightIntelView } from "./compute-overnight-intel";
import { buildEpaMovers, buildOvernightSummaryText, summarizeResearchFindings, summarizeScoutingActivity } from ".";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const EVENT = "2026txho";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeOvernightIntelView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeOvernightIntelView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
      expect(view.steps[0]?.href).toBe("/workspace");
      expect(view.steps.some((s) => s.href.includes("/competition?tab=command"))).toBe(true);
      expect(view.steps.every((s) => !s.href.toLowerCase().includes("demo"))).toBe(true);
    }
  });

  it("returns setup_required when the org has no active event", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 1234 }] };
      if (sql.includes("FROM org_active_context")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeOvernightIntelView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBe(ORG);
      expect(view.steps[0]?.id).toBe("active-event");
      expect(view.steps[0]?.href).toBe(`/team/data?orgId=${ORG}`);
      expect(view.steps.some((s) => s.href.includes("/competition?tab=command"))).toBe(true);
      expect(view.steps.every((s) => !s.href.toLowerCase().includes("demo"))).toBe(true);
    }
  });

  it("returns a live view with signals computed from research, EPA, and scouting rows", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 1234 }] };
      if (sql.includes("FROM org_active_context")) {
        return { rows: [{ eventKey: EVENT, eventName: "Houston Regional", seasonYear: 2026 }] };
      }
      if (sql.includes("FROM overnight_intel_briefs")) return { rows: [] };
      if (sql.includes("FROM research_findings")) {
        return {
          rows: [
            {
              teamKey: "frc254",
              teamNumber: 254,
              title: "New swerve reveal",
              summary: "Team 254 revealed a new swerve module design on their CD thread.",
              sourceType: "cd_post",
              sourceUrl: "https://chiefdelphi.com/t/254-reveal",
              foundAt: "2026-01-02T04:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM team_event_metrics")) {
        return {
          rows: [
            { teamKey: "frc254", teamNumber: 254, epaTotal: 42.5 },
            { teamKey: "frc118", teamNumber: 118, epaTotal: 30 },
          ],
        };
      }
      if (sql.includes("FROM overnight_intel_epa_snapshots")) {
        return {
          rows: [{ teamKey: "frc254", epaTotal: 40, capturedAt: "2026-01-01T04:00:00.000Z" }],
        };
      }
      if (sql.includes("FROM match_scout_entries")) {
        return {
          rows: [{ teamKey: "frc254", teamNumber: 254, newEntries: 3, lastScoutedAt: "2026-01-02T05:00:00.000Z" }],
        };
      }
      return { rows: [] };
    });

    const view = await computeOvernightIntelView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.eventKey).toBe(EVENT);
    expect(view.latestBrief).toBeNull();
    expect(view.signals.researchHighlights).toHaveLength(1);
    expect(view.signals.researchHighlights[0]?.teamNumber).toBe(254);
    // frc254 moved 40 -> 42.5 (>= 0.75 threshold); frc118 has no prior snapshot so it's skipped.
    expect(view.signals.epaMovers).toHaveLength(1);
    expect(view.signals.epaMovers[0]?.teamKey).toBe("frc254");
    expect(view.signals.epaMovers[0]?.deltaEpa).toBeCloseTo(2.5);
    expect(view.signals.scoutingHighlights).toHaveLength(1);
    expect(view.signals.scoutingHighlights[0]?.newEntries).toBe(3);
  });
});

describe("overnight-intel pure helpers", () => {
  it("buildEpaMovers only surfaces deltas at/above the significance threshold, sorted by magnitude", () => {
    const movers = buildEpaMovers(
      [
        { teamKey: "frc1", teamNumber: 1, epaTotal: 20 },
        { teamKey: "frc2", teamNumber: 2, epaTotal: 20.1 },
        { teamKey: "frc3", teamNumber: 3, epaTotal: 30 },
      ],
      [
        { teamKey: "frc1", epaTotal: 15, capturedAt: "2026-01-01T00:00:00.000Z" },
        { teamKey: "frc2", epaTotal: 20, capturedAt: "2026-01-01T00:00:00.000Z" },
        { teamKey: "frc3", epaTotal: 25, capturedAt: "2026-01-01T00:00:00.000Z" },
      ],
    );
    expect(movers.map((m) => m.teamKey)).toEqual(["frc1", "frc3"]);
    expect(movers[0]?.teamKey).toBe("frc1");
  });

  it("summarizeResearchFindings sorts newest-first and caps at 15", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      teamKey: `frc${i}`,
      teamNumber: i,
      title: `Finding ${i}`,
      summary: "summary",
      sourceType: "cd_post",
      sourceUrl: "https://example.com",
      foundAt: new Date(2026, 0, 1, i).toISOString(),
    }));
    const highlights = summarizeResearchFindings(rows);
    expect(highlights).toHaveLength(15);
    expect(highlights[0]?.title).toBe("Finding 19");
  });

  it("summarizeScoutingActivity drops zero-entry rows and sorts by volume", () => {
    const rows = [
      { teamKey: "frc1", teamNumber: 1, newEntries: 0, lastScoutedAt: "2026-01-01T00:00:00.000Z" },
      { teamKey: "frc2", teamNumber: 2, newEntries: 5, lastScoutedAt: "2026-01-01T00:00:00.000Z" },
    ];
    const highlights = summarizeScoutingActivity(rows);
    expect(highlights).toHaveLength(1);
    expect(highlights[0]?.teamKey).toBe("frc2");
  });

  it("buildOvernightSummaryText never fabricates — empty signals produce a plain no-change narrative", () => {
    const text = buildOvernightSummaryText({
      eventName: "Houston Regional",
      briefDate: "2026-01-02",
      researchHighlights: [],
      epaMovers: [],
      scoutingHighlights: [],
    });
    expect(text).toContain("Houston Regional");
    expect(text).toContain("No new research findings");
    expect(text).toContain("No material EPA movement");
    expect(text).toContain("No new scouting entries");
  });
});
