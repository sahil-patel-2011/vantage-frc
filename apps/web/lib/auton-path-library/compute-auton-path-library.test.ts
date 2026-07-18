import { describe, expect, it } from "vitest";
import { computeAutonPathLibraryView } from "./compute-auton-path-library";
import { autonPathRunOutcomeLabel, autonPathStartPositionLabel, computePathStats, summarizeLibrary } from ".";
import type { AutonPathRun, AutonPathWithStats } from "./types";

type QueryCall = { sql: string; params: unknown[] };

function makeMockClient(rowsBySql: (sql: string) => unknown[]) {
  const calls: QueryCall[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: rowsBySql(sql), rowCount: rowsBySql(sql).length };
    },
  };
  return { client: client as unknown as import("@neondatabase/serverless").PoolClient, calls };
}

describe("computeAutonPathLibraryView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const { client } = makeMockClient(() => []);
    const view = await computeAutonPathLibraryView(client, { userId: "u1", requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with paths, stats, and summary for a real org", async () => {
    const { client } = makeMockClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return [{ orgId: "org-1", teamNumber: 254 }];
      }
      if (sql.includes("FROM auton_path_library_paths") && sql.includes("SELECT id, name")) {
        return [
          {
            id: "p1",
            name: "Left 2-piece",
            startPosition: "left",
            description: "Grab and score two pieces from the left start.",
            gamePieces: 2,
            seasonYear: 2026,
            active: true,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "p2",
            name: "Center mobility only",
            startPosition: "center",
            description: null,
            gamePieces: 0,
            seasonYear: 2026,
            active: true,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ];
      }
      if (sql.includes("FROM auton_path_library_runs")) {
        return [
          {
            id: "r1",
            pathId: "p1",
            outcome: "success",
            occurredOn: "2026-02-01",
            eventLabel: "Week 1",
            matchLabel: "Q3",
            notes: null,
            loggedBy: "u1",
            createdAt: "2026-02-01T00:00:00.000Z",
          },
          {
            id: "r2",
            pathId: "p1",
            outcome: "fail",
            occurredOn: "2026-02-02",
            eventLabel: "Week 1",
            matchLabel: "Q5",
            notes: "Missed the second piece",
            loggedBy: "u1",
            createdAt: "2026-02-02T00:00:00.000Z",
          },
          {
            id: "r3",
            pathId: "p1",
            outcome: "success",
            occurredOn: "2026-02-03",
            eventLabel: "Week 1",
            matchLabel: "Q8",
            notes: null,
            loggedBy: "u1",
            createdAt: "2026-02-03T00:00:00.000Z",
          },
        ];
      }
      if (sql.includes("DISTINCT season_year")) {
        return [{ seasonYear: 2026 }];
      }
      return [];
    });

    const view = await computeAutonPathLibraryView(client, {
      userId: "u1",
      requestedOrg: "org-1",
      seasonYear: 2026,
    });

    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe("org-1");
      expect(view.teamNumber).toBe(254);
      expect(view.paths).toHaveLength(2);
      const left = view.paths.find((p) => p.id === "p1");
      expect(left?.stats.totalRuns).toBe(3);
      expect(left?.stats.successRuns).toBe(2);
      expect(left?.stats.successRate).toBeCloseTo(2 / 3);
      const center = view.paths.find((p) => p.id === "p2");
      expect(center?.stats.totalRuns).toBe(0);
      expect(center?.stats.successRate).toBeNull();
      expect(view.summary.totalPaths).toBe(2);
      expect(view.summary.totalRuns).toBe(3);
      expect(view.summary.bestPathId).toBe("p1");
    }
  });
});

describe("computePathStats", () => {
  it("returns nulls for a path with no runs", () => {
    const stats = computePathStats("p1", []);
    expect(stats.totalRuns).toBe(0);
    expect(stats.successRate).toBeNull();
    expect(stats.lastRunOn).toBeNull();
  });

  it("computes success rate and last-run date from mixed outcomes", () => {
    const runs: AutonPathRun[] = [
      {
        id: "r1",
        pathId: "p1",
        outcome: "success",
        occurredOn: "2026-01-05",
        eventLabel: null,
        matchLabel: null,
        notes: null,
        loggedBy: "u1",
        createdAt: "2026-01-05T00:00:00.000Z",
      },
      {
        id: "r2",
        pathId: "p1",
        outcome: "partial",
        occurredOn: "2026-01-10",
        eventLabel: null,
        matchLabel: null,
        notes: null,
        loggedBy: "u1",
        createdAt: "2026-01-10T00:00:00.000Z",
      },
      {
        id: "r3",
        pathId: "other-path",
        outcome: "fail",
        occurredOn: "2026-01-20",
        eventLabel: null,
        matchLabel: null,
        notes: null,
        loggedBy: "u1",
        createdAt: "2026-01-20T00:00:00.000Z",
      },
    ];
    const stats = computePathStats("p1", runs);
    expect(stats.totalRuns).toBe(2);
    expect(stats.successRuns).toBe(1);
    expect(stats.partialRuns).toBe(1);
    expect(stats.failRuns).toBe(0);
    expect(stats.successRate).toBe(0.5);
    expect(stats.lastRunOn).toBe("2026-01-10");
  });
});

describe("summarizeLibrary", () => {
  it("requires a minimum of 3 runs before ranking a best path", () => {
    const paths: AutonPathWithStats[] = [
      {
        id: "p1",
        name: "Path A",
        startPosition: "left",
        description: null,
        gamePieces: 1,
        seasonYear: 2026,
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        stats: { pathId: "p1", totalRuns: 1, successRuns: 1, partialRuns: 0, failRuns: 0, successRate: 1, lastRunOn: "2026-01-01" },
      },
    ];
    const summary = summarizeLibrary(paths);
    expect(summary.bestPathId).toBeNull();
    expect(summary.overallSuccessRate).toBe(1);
  });

  it("returns null overall success rate with zero runs", () => {
    const summary = summarizeLibrary([]);
    expect(summary.overallSuccessRate).toBeNull();
    expect(summary.totalRuns).toBe(0);
  });
});

describe("labels", () => {
  it("labels start positions and run outcomes", () => {
    expect(autonPathStartPositionLabel("left")).toBe("Left");
    expect(autonPathStartPositionLabel("other")).toBe("Other");
    expect(autonPathRunOutcomeLabel("partial")).toBe("Partial");
  });
});
