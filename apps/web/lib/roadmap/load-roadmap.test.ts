/**
 * Node-only tests for the roadmap loader. No DB: the PoolClient is a stub that
 * answers by SQL shape, which is enough to pin the honesty rules that matter —
 * no kickoff date invented, unknown task ids dropped, and a database missing
 * migration 0459 degrading instead of throwing.
 */
import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import {
  RoadmapNotConfiguredError,
  computeRoadmapView,
  saveSettings,
  saveTaskStatus,
  setupRequired,
} from "./load-roadmap";
import { ROADMAP_TASKS } from "./season-roadmap";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const REAL_TASK = ROADMAP_TASKS[0]!.id;

type Reply = { rows: unknown[]; rowCount?: number };

function mockClient(handler: (sql: string, params: unknown[]) => Reply): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => {
      const reply = handler(sql, params);
      return Promise.resolve({ ...reply, rowCount: reply.rowCount ?? reply.rows.length });
    }),
  } as unknown as PoolClient;
}

type Fixture = {
  member?: boolean;
  tables?: string[];
  kickoffDate?: string | null;
  rookieOnly?: boolean | null;
  rookieYear?: number | null;
  progress?: Array<Record<string, unknown>>;
};

function fixtureClient(fixture: Fixture = {}): PoolClient {
  const tables = fixture.tables ?? [
    "season_roadmap_progress",
    "season_roadmap_settings",
    "teams_ref",
  ];
  return mockClient((sql) => {
    if (sql.includes("FROM memberships")) {
      return fixture.member === false
        ? { rows: [] }
        : { rows: [{ orgId: ORG, teamNumber: 9999, role: "owner" }] };
    }
    if (sql.includes("to_regclass")) return { rows: tables.map((name) => ({ name })) };
    if (sql.includes("FROM season_roadmap_settings")) {
      return {
        rows: [
          {
            kickoffDate: fixture.kickoffDate ?? null,
            rookieOnly: fixture.rookieOnly ?? null,
          },
        ],
      };
    }
    if (sql.includes("FROM season_roadmap_progress")) return { rows: fixture.progress ?? [] };
    if (sql.includes("FROM teams_ref")) return { rows: [{ rookieYear: fixture.rookieYear ?? null }] };
    return { rows: [] };
  });
}

describe("computeRoadmapView", () => {
  it("asks for a team when the user has no membership", async () => {
    const view = await computeRoadmapView(fixtureClient({ member: false }), {
      userId: USER,
      requestedOrg: null,
      today: "2026-01-10",
    });
    expect(view.status).toBe("setup_required");
  });

  it("renders no dates at all when no kickoff date is stored", async () => {
    const view = await computeRoadmapView(fixtureClient({ kickoffDate: null }), {
      userId: USER,
      requestedOrg: null,
      today: "2026-01-10",
    });
    if (view.status !== "live") throw new Error("expected live");
    expect(view.roadmap.kickoffDate).toBeNull();
    for (const phase of view.roadmap.phases) {
      expect(phase.dates).toBeNull();
      for (const task of phase.tasks) expect(task.dates).toBeNull();
    }
  });

  it("still answers 'what is due next' without a kickoff date", async () => {
    const view = await computeRoadmapView(fixtureClient({ kickoffDate: null }), {
      userId: USER,
      requestedOrg: null,
      today: "2026-01-10",
    });
    if (view.status !== "live") throw new Error("expected live");
    expect(view.roadmap.dueNext.length).toBeGreaterThan(0);
  });

  it("dates every window from the stored kickoff date", async () => {
    const view = await computeRoadmapView(fixtureClient({ kickoffDate: "2026-01-03" }), {
      userId: USER,
      requestedOrg: null,
      today: "2026-01-10",
    });
    if (view.status !== "live") throw new Error("expected live");
    const kickoffPhase = view.roadmap.phases.find((phase) => phase.id === "kickoff")!;
    expect(kickoffPhase.dates?.start).toBe("2026-01-03");
  });

  it("accepts a Date object from pg for a date column", async () => {
    const view = await computeRoadmapView(
      fixtureClient({ kickoffDate: new Date("2026-01-03T00:00:00.000Z") as unknown as string }),
      { userId: USER, requestedOrg: null, today: "2026-01-10" },
    );
    if (view.status !== "live") throw new Error("expected live");
    expect(view.roadmap.kickoffDate).toBe("2026-01-03");
  });

  it("ignores a malformed stored kickoff date rather than rendering a broken timeline", async () => {
    const view = await computeRoadmapView(fixtureClient({ kickoffDate: "not-a-date" }), {
      userId: USER,
      requestedOrg: null,
      today: "2026-01-10",
    });
    if (view.status !== "live") throw new Error("expected live");
    expect(view.roadmap.kickoffDate).toBeNull();
  });

  it("drops progress rows for task ids we no longer ship", async () => {
    const view = await computeRoadmapView(
      fixtureClient({
        progress: [
          { taskId: "a-task-we-deleted", status: "done", note: null, completedByName: null, completedAt: null },
          { taskId: REAL_TASK, status: "done", note: "paid", completedByName: "Sam", completedAt: null },
        ],
      }),
      { userId: USER, requestedOrg: null, today: "2026-01-10" },
    );
    if (view.status !== "live") throw new Error("expected live");
    expect(view.roadmap.summary.done).toBe(1);
  });

  it("ignores an unrecognised stored status instead of trusting it", async () => {
    const view = await computeRoadmapView(
      fixtureClient({
        progress: [{ taskId: REAL_TASK, status: "finished-ish", note: null, completedByName: null, completedAt: null }],
      }),
      { userId: USER, requestedOrg: null, today: "2026-01-10" },
    );
    if (view.status !== "live") throw new Error("expected live");
    expect(view.roadmap.summary.done).toBe(0);
  });

  it("says rookie-ness is unknown when teams_ref has no rookie year", async () => {
    const view = await computeRoadmapView(fixtureClient({ rookieYear: null }), {
      userId: USER,
      requestedOrg: null,
      today: "2026-01-10",
    });
    if (view.status !== "live") throw new Error("expected live");
    expect(view.rookieKnown).toBeNull();
    // Unknown must show everything, never silently hide veteran tasks.
    expect(view.roadmap.rookieOnly).toBe(false);
  });

  it("detects a rookie team from teams_ref.rookie_year", async () => {
    const view = await computeRoadmapView(
      fixtureClient({ rookieYear: 2026, kickoffDate: "2026-01-03" }),
      { userId: USER, requestedOrg: null, today: "2026-01-10" },
    );
    if (view.status !== "live") throw new Error("expected live");
    expect(view.rookieKnown).toBe(true);
    expect(view.roadmap.rookieOnly).toBe(true);
    for (const phase of view.roadmap.phases) {
      for (const task of phase.tasks) expect(task.isRookieCritical).toBe(true);
    }
  });

  it("lets the team's stored choice override the reference data", async () => {
    const view = await computeRoadmapView(
      fixtureClient({ rookieYear: 2026, kickoffDate: "2026-01-03", rookieOnly: false }),
      { userId: USER, requestedOrg: null, today: "2026-01-10" },
    );
    if (view.status !== "live") throw new Error("expected live");
    expect(view.roadmap.rookieOnly).toBe(false);
  });

  it("lets the page's toggle override everything for one render", async () => {
    const view = await computeRoadmapView(
      fixtureClient({ rookieYear: 2010, rookieOnly: false }),
      { userId: USER, requestedOrg: null, today: "2026-01-10", rookieOverride: true },
    );
    if (view.status !== "live") throw new Error("expected live");
    expect(view.roadmap.rookieOnly).toBe(true);
  });

  it("degrades to an empty, dateless roadmap when migration 0459 is absent", async () => {
    const view = await computeRoadmapView(fixtureClient({ tables: [] }), {
      userId: USER,
      requestedOrg: null,
      today: "2026-01-10",
    });
    if (view.status !== "live") throw new Error("expected live");
    expect(view.roadmap.kickoffDate).toBeNull();
    expect(view.roadmap.summary.done).toBe(0);
    expect(view.roadmap.phases.length).toBeGreaterThan(0);
  });
});

describe("writes", () => {
  it("refuses to write settings when the table is absent", async () => {
    await expect(
      saveSettings(fixtureClient({ tables: [] }), {
        orgId: ORG,
        userId: USER,
        kickoffDate: "2026-01-03",
        rookieOnly: null,
      }),
    ).rejects.toBeInstanceOf(RoadmapNotConfiguredError);
  });

  it("refuses to write progress when the table is absent", async () => {
    await expect(
      saveTaskStatus(fixtureClient({ tables: [] }), {
        orgId: ORG,
        userId: USER,
        taskId: REAL_TASK,
        status: "done",
        note: null,
      }),
    ).rejects.toBeInstanceOf(RoadmapNotConfiguredError);
  });

  it("only stamps completed_at for a done task", async () => {
    const seen: string[] = [];
    const client = mockClient((sql) => {
      seen.push(sql);
      if (sql.includes("to_regclass")) return { rows: [{ name: "season_roadmap_progress" }] };
      return { rows: [] };
    });
    await saveTaskStatus(client, {
      orgId: ORG,
      userId: USER,
      taskId: REAL_TASK,
      status: "skipped",
      note: null,
    });
    const insert = seen.find((sql) => sql.includes("INSERT INTO season_roadmap_progress"))!;
    expect(insert).toContain("CASE WHEN $3::text = 'done' THEN now() ELSE NULL END");
  });

  it("passes every value as a bound parameter, never string-concatenated", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = mockClient((sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("to_regclass")) return { rows: [{ name: "season_roadmap_settings" }] };
      return { rows: [] };
    });
    await saveSettings(client, {
      orgId: ORG,
      userId: USER,
      kickoffDate: "2026-01-03",
      rookieOnly: true,
    });
    const insert = calls.find((call) => call.sql.includes("INSERT INTO season_roadmap_settings"))!;
    expect(insert.params).toEqual([ORG, "2026-01-03", true, USER]);
    expect(insert.sql).not.toContain(ORG);
  });
});

describe("setupRequired", () => {
  it("names the team step so the page is never a dead end", () => {
    const state = setupRequired(null);
    expect(state.steps.length).toBeGreaterThan(0);
    expect(state.steps[0]!.href).toBe("/workspace");
  });
});
