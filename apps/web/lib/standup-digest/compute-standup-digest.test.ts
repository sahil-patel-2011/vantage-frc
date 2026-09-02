import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeStandupDigestView, generateDigest } from "./compute-standup-digest";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const DATE = "2026-02-10";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeStandupDigestView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeStandupDigestView(client, { userId: USER, requestedOrg: null, digestDate: DATE });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.digestDate).toBe(DATE);
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view compiling hours, task movement, blockers, attendance, and wiki edits", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM hour_logs")) {
        return {
          rows: [
            { userId: "u1", name: "Ada", kind: "build", hours: 3.5 },
            { userId: "u2", name: "Grace", kind: "outreach", hours: 1 },
          ],
        };
      }
      if (sql.includes("FROM build_tasks") && sql.includes("done_at >=")) {
        return {
          rows: [
            {
              id: "t1",
              title: "Mount shooter hood",
              subsystem: "shooter",
              status: "done",
              assignee: "Ada",
              doneAt: "2026-02-10T15:00:00.000Z",
              createdAt: "2026-02-08T12:00:00.000Z",
              updatedAt: "2026-02-10T15:00:00.000Z",
            },
            {
              id: "t2",
              title: "Wire climber motor",
              subsystem: "climber",
              status: "blocked",
              assignee: "Grace",
              doneAt: null,
              createdAt: "2026-02-09T12:00:00.000Z",
              updatedAt: "2026-02-10T18:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM build_tasks") && sql.includes("status = 'blocked'")) {
        return {
          rows: [
            {
              id: "t2",
              title: "Wire climber motor",
              subsystem: "climber",
              assignee: "Grace",
              blockedReason: "Waiting on part",
              createdAt: "2026-02-09T12:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM attendance_events")) {
        return {
          rows: [
            {
              id: "e1",
              title: "Tuesday build",
              kind: "build",
              occurredOn: DATE,
              creditHours: "2.00",
              attendeeCount: 5,
            },
          ],
        };
      }
      if (sql.includes("FROM knowledge_pages")) {
        return {
          rows: [
            {
              id: "p1",
              title: "Climber assembly notes",
              updatedByName: "Grace",
              updatedAt: "2026-02-10T20:00:00.000Z",
              created: false,
            },
          ],
        };
      }
      if (sql.includes("FROM standup_digest_runs")) return { rows: [] };
      if (sql.includes("FROM standup_digest_notes")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeStandupDigestView(client, { userId: USER, requestedOrg: ORG, digestDate: DATE });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.summary.hours.totalHours).toBe(4.5);
    expect(view.summary.taskMovement).toHaveLength(2);
    expect(view.summary.taskMovement.find((m) => m.taskId === "t1")?.event).toBe("completed");
    expect(view.summary.taskMovement.find((m) => m.taskId === "t2")?.event).toBe("blocked");
    expect(view.summary.blockers).toHaveLength(1);
    expect(view.summary.attendance.totalAttendees).toBe(5);
    expect(view.summary.knowledgeEdits).toHaveLength(1);
    expect(view.summary.subteamBriefs.map((b) => b.subteam)).toEqual(["climber", "shooter"]);
    expect(view.summary.headline).toContain(DATE);
    expect(view.latestRun).toBeNull();
  });
});

describe("generateDigest", () => {
  it("computes a summary, meters the deterministic headline synthesis, and upserts the run", async () => {
    const inserts: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM hour_logs")) return { rows: [{ userId: "u1", name: "Ada", kind: "build", hours: 2 }] };
      if (sql.includes("FROM build_tasks") && sql.includes("done_at >=")) return { rows: [] };
      if (sql.includes("FROM build_tasks") && sql.includes("status = 'blocked'")) return { rows: [] };
      if (sql.includes("FROM attendance_events")) return { rows: [] };
      if (sql.includes("FROM knowledge_pages")) return { rows: [] };
      if ((sql.includes("INSERT INTO ai_usage_events") || sql.includes("INSERT INTO ai_render_attempts"))) {
        inserts.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO standup_digest_runs")) {
        inserts.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    const summary = await generateDigest(client, { orgId: ORG, userId: USER, digestDate: DATE });

    expect(summary.hours.totalHours).toBe(2);
    const usageInsert = inserts.find((entry) => (entry.sql.includes("INSERT INTO ai_usage_events") || entry.sql.includes("INSERT INTO ai_render_attempts")));
    expect(usageInsert).toBeDefined();
    const runUpsert = inserts.find((entry) => entry.sql.includes("INSERT INTO standup_digest_runs"));
    expect(runUpsert).toBeDefined();
    expect(runUpsert?.params).toContain(DATE);
  });
});
