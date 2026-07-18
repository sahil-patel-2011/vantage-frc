import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeScoutCoverageLiveView } from "./compute-scout-coverage-live";
import { buildCoverageCells, coverageStatusFor, rankCoverageGaps, summarizeCoverage, teamKeysFromAlliance } from ".";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const EVENT = "2026txho";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeScoutCoverageLiveView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeScoutCoverageLiveView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("throws forbidden when an explicit foreign orgId is requested", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    await expect(
      computeScoutCoverageLiveView(client, {
        userId: USER,
        requestedOrg: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    ).rejects.toMatchObject({ message: "forbidden", status: 403 });
  });

  it("returns setup_required when the org has no active event", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 1234 }] };
      if (sql.includes("FROM org_active_context")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeScoutCoverageLiveView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBe(ORG);
      expect(view.steps[0]?.id).toBe("active-event");
    }
  });

  it("returns a live view with a coverage grid computed from schedule + scout entry counts", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 1234 }] };
      if (sql.includes("FROM org_active_context")) return { rows: [{ eventKey: EVENT }] };
      if (sql.includes("FROM matches_ref")) {
        return {
          rows: [
            {
              matchKey: `${EVENT}_qm1`,
              compLevel: "qm",
              setNumber: 1,
              matchNumber: 1,
              redAlliance: { team_keys: ["frc254", "frc118"] },
              blueAlliance: { team_keys: ["frc1323", "frc4414"] },
            },
          ],
        };
      }
      if (sql.includes("FROM scout_coverage_live_settings")) return { rows: [] };
      if (sql.includes("FROM teams_ref")) {
        return {
          rows: [
            { teamKey: "frc254", teamNumber: 254 },
            { teamKey: "frc118", teamNumber: 118 },
            { teamKey: "frc1323", teamNumber: 1323 },
            { teamKey: "frc4414", teamNumber: 4414 },
          ],
        };
      }
      if (sql.includes("FROM match_scout_entries")) {
        return {
          rows: [{ matchKey: `${EVENT}_qm1`, teamKey: "frc254", entryCount: 3 }],
        };
      }
      if (sql.includes("FROM scout_coverage_live_nudges")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeScoutCoverageLiveView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.eventKey).toBe(EVENT);
    expect(view.cells).toHaveLength(4);
    expect(view.summary.zeroCount).toBe(3);
    expect(view.summary.coveredCount).toBe(1);
    const scored254 = view.cells.find((c) => c.teamKey === "frc254");
    expect(scored254?.status).toBe("covered");
    const unscored118 = view.cells.find((c) => c.teamKey === "frc118");
    expect(unscored118?.status).toBe("zero");
    expect(view.gaps.length).toBeGreaterThan(0);
    expect(view.gaps.every((g) => g.status !== "covered")).toBe(true);
  });
});

describe("scout-coverage-live pure helpers", () => {
  it("coverageStatusFor classifies zero, thin, and covered entry counts", () => {
    expect(coverageStatusFor(0, 2)).toBe("zero");
    expect(coverageStatusFor(1, 2)).toBe("thin");
    expect(coverageStatusFor(2, 2)).toBe("covered");
  });

  it("teamKeysFromAlliance handles both TBA jsonb shapes", () => {
    expect(teamKeysFromAlliance({ team_keys: ["frc1", "frc2"] })).toEqual(["frc1", "frc2"]);
    expect(teamKeysFromAlliance(["frc3"])).toEqual(["frc3"]);
    expect(teamKeysFromAlliance(null)).toEqual([]);
  });

  it("buildCoverageCells skips teams with no known team_number mapping", () => {
    const cells = buildCoverageCells({
      matches: [
        {
          matchKey: "m1",
          compLevel: "qm",
          setNumber: 1,
          matchNumber: 1,
          redTeamKeys: ["frc1", "frc2"],
          blueTeamKeys: ["frc3"],
        },
      ],
      entryCounts: new Map([["m1::frc1", 5]]),
      teamNumbers: new Map([
        ["frc1", 1],
        ["frc3", 3],
      ]),
      thinThreshold: 2,
    });
    expect(cells).toHaveLength(2);
    expect(cells.find((c) => c.teamKey === "frc2")).toBeUndefined();
  });

  it("summarizeCoverage and rankCoverageGaps rank zero before thin, in schedule order", () => {
    const cells = buildCoverageCells({
      matches: [
        { matchKey: "m2", compLevel: "qm", setNumber: 1, matchNumber: 2, redTeamKeys: ["frc1"], blueTeamKeys: [] },
        { matchKey: "m1", compLevel: "qm", setNumber: 1, matchNumber: 1, redTeamKeys: ["frc2"], blueTeamKeys: [] },
      ],
      entryCounts: new Map([["m1::frc2", 1]]),
      teamNumbers: new Map([
        ["frc1", 1],
        ["frc2", 2],
      ]),
      thinThreshold: 2,
    });
    const summary = summarizeCoverage(cells);
    expect(summary.totalCells).toBe(2);
    expect(summary.zeroCount).toBe(1);
    expect(summary.thinCount).toBe(1);
    const gaps = rankCoverageGaps(cells);
    expect(gaps[0]?.status).toBe("zero");
    expect(gaps[1]?.status).toBe("thin");
  });
});
