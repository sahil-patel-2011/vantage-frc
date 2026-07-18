import { describe, expect, it } from "vitest";
import { computeBuildBurndownView } from "./compute-build-burndown";
import { buildTaskCategoryLabel, buildTaskStatusLabel, computeBurndownSeries, summarizeBurndown } from ".";
import type { BuildBurndownPlan, BuildBurndownTask } from "./types";

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

let seq = 0;
function task(overrides: Partial<BuildBurndownTask> = {}): BuildBurndownTask {
  seq += 1;
  return {
    id: `task-${seq}`,
    title: `Task ${seq}`,
    category: "mechanical",
    status: "pending",
    plannedDate: "2026-02-01",
    completedOn: null,
    seasonYear: 2026,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeBuildBurndownView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const { client } = makeMockClient(() => []);
    const view = await computeBuildBurndownView(client, { userId: "u1", requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with tasks, plan, series, and summary for a real org", async () => {
    const { client } = makeMockClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return [{ orgId: "org-1", teamNumber: 254 }];
      }
      if (sql.includes("FROM build_burndown_tasks") && sql.includes("SELECT id, title")) {
        return [
          {
            id: "t1",
            title: "Machine chassis",
            category: "mechanical",
            status: "done",
            plannedDate: "2026-01-10",
            completedOn: "2026-01-09",
            seasonYear: 2026,
            notes: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "t2",
            title: "Wire electronics",
            category: "electrical",
            status: "pending",
            plannedDate: "2026-01-20",
            completedOn: null,
            seasonYear: 2026,
            notes: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ];
      }
      if (sql.includes("FROM build_burndown_plans") && sql.includes("SELECT id, season_year")) {
        return [
          {
            id: "p1",
            seasonYear: 2026,
            kickoffDate: "2026-01-01",
            competitionDate: "2026-01-25",
          },
        ];
      }
      if (sql.includes("UNION")) {
        return [{ seasonYear: 2026 }];
      }
      return [];
    });

    const view = await computeBuildBurndownView(client, {
      userId: "u1",
      requestedOrg: "org-1",
      seasonYear: 2026,
    });

    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe("org-1");
      expect(view.teamNumber).toBe(254);
      expect(view.tasks).toHaveLength(2);
      expect(view.plan?.kickoffDate).toBe("2026-01-01");
      expect(view.series.length).toBeGreaterThan(0);
      expect(view.summary.totalTasks).toBe(2);
      expect(view.summary.completedTasks).toBe(1);
      expect(view.summary.remainingTasks).toBe(1);
    }
  });
});

describe("summarizeBurndown", () => {
  it("returns an all-zero summary for no tasks", () => {
    const s = summarizeBurndown([], null);
    expect(s.totalTasks).toBe(0);
    expect(s.completedTasks).toBe(0);
    expect(s.remainingTasks).toBe(0);
    expect(s.byCategory).toEqual([]);
    expect(s.paceSignal).toBe(0);
  });

  it("counts completed, remaining, blocked, and overdue tasks", () => {
    const today = new Date("2026-02-01T00:00:00.000Z");
    const tasks = [
      task({ status: "done", completedOn: "2026-01-15" }),
      task({ status: "blocked", plannedDate: "2026-01-10" }),
      task({ status: "pending", plannedDate: "2026-03-01" }),
    ];
    const s = summarizeBurndown(tasks, null, today);
    expect(s.totalTasks).toBe(3);
    expect(s.completedTasks).toBe(1);
    expect(s.remainingTasks).toBe(2);
    expect(s.blockedTasks).toBe(1);
    expect(s.overdueTasks).toBe(1); // the blocked task's planned date has passed
  });
});

describe("computeBurndownSeries", () => {
  const plan: BuildBurndownPlan = {
    id: "p1",
    seasonYear: 2026,
    kickoffDate: "2026-01-01",
    competitionDate: "2026-01-05",
  };

  it("returns an empty series when there are no tasks", () => {
    expect(computeBurndownSeries([], plan)).toEqual([]);
  });

  it("builds a planned line that starts at the total task count", () => {
    const tasks = [
      task({ plannedDate: "2026-01-02" }),
      task({ plannedDate: "2026-01-04" }),
    ];
    const series = computeBurndownSeries(tasks, plan, new Date("2026-01-06T00:00:00.000Z"));
    expect(series[0]?.date).toBe("2026-01-01");
    expect(series[0]?.planned).toBe(2);
    expect(series[series.length - 1]?.date).toBe("2026-01-05");
  });

  it("only populates actual remaining up through today", () => {
    const tasks = [task({ plannedDate: "2026-01-02", completedOn: "2026-01-02" })];
    const series = computeBurndownSeries(tasks, plan, new Date("2026-01-02T00:00:00.000Z"));
    const future = series.find((p) => p.date === "2026-01-05");
    expect(future?.actual).toBeNull();
    const day1 = series.find((p) => p.date === "2026-01-01");
    expect(day1?.actual).toBe(1);
  });
});

describe("labels", () => {
  it("labels categories and statuses", () => {
    expect(buildTaskCategoryLabel("drivetrain")).toBe("Drivetrain");
    expect(buildTaskStatusLabel("in_progress")).toBe("In progress");
  });
});
