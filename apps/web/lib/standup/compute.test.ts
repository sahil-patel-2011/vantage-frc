import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { computeStandupView } from "./compute";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const DATE = "2026-02-10";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[] }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeStandupView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("JOIN organizations")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeStandupView(client, { userId: USER, requestedOrg: null, digestDate: DATE });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.digestDate).toBe(DATE);
      expect(view.steps[0]?.href).toBe("/workspace");
    }
  });

  it("returns empty when the org has no closed hours and no in-window movement", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("JOIN organizations")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM hour_logs")) return { rows: [] };
      if (sql.includes("FROM team_todos")) {
        return {
          rows: [
            {
              id: "t-open",
              title: "Order more belts",
              status: "todo",
              dueOn: null,
              assigneeUserId: null,
              assigneeName: null,
              subteamId: null,
              subteamName: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              completedAt: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const view = await computeStandupView(client, { userId: USER, requestedOrg: ORG, digestDate: DATE });

    expect(view.status).toBe("empty");
    if (view.status === "empty") {
      expect(view.orgId).toBe(ORG);
      expect(view.digestDate).toBe(DATE);
      expect(view.standingBlockers).toBe(0);
      expect(view.steps.map((step) => step.id)).toEqual(["hours", "work"]);
    }
  });

  it("returns empty when hour_logs is missing rather than failing closed", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("JOIN organizations")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM hour_logs")) throw new Error("relation hour_logs does not exist");
      return { rows: [] };
    });

    const view = await computeStandupView(client, { userId: USER, requestedOrg: ORG, digestDate: DATE });
    expect(view.status).toBe("empty");
  });

  it("returns live from closed hours and completed work items", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("JOIN organizations")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM hour_logs")) {
        return {
          rows: [
            { userId: "u1", name: "Ada", kind: "build", hours: 3.5 },
            { userId: "u2", name: "Grace", kind: "outreach", hours: 1 },
          ],
        };
      }
      if (sql.includes("FROM team_todos")) {
        return {
          rows: [
            {
              id: "t-done",
              title: "Mount shooter hood",
              status: "done",
              dueOn: null,
              assigneeUserId: "u1",
              assigneeName: "Ada",
              subteamId: null,
              subteamName: "shooter",
              createdAt: "2026-02-08T12:00:00.000Z",
              completedAt: "2026-02-10T15:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM build_tasks")) {
        return {
          rows: [
            {
              id: "b-block",
              title: "Wire climber motor",
              status: "blocked",
              dueOn: null,
              assignees: ["Grace"],
              subsystem: "climber",
              createdAt: "2026-02-09T12:00:00.000Z",
              doneAt: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const view = await computeStandupView(client, { userId: USER, requestedOrg: ORG, digestDate: DATE });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.digest.hours.totalHours).toBe(4.5);
    expect(view.digest.movement).toHaveLength(1);
    expect(view.digest.movement[0]?.event).toBe("completed");
    expect(view.digest.movement[0]?.title).toBe("Mount shooter hood");
    expect(view.digest.blockers).toHaveLength(1);
    expect(view.digest.headline).toBe("2026-02-10: 4.5h logged · 1 completed");
  });

  it("is live from hours alone when no tasks moved", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("JOIN organizations")) return { rows: [{ orgId: ORG, teamNumber: null }] };
      if (sql.includes("FROM hour_logs")) {
        return { rows: [{ userId: "u1", name: "Ada", kind: "build", hours: 2 }] };
      }
      return { rows: [] };
    });

    const view = await computeStandupView(client, { userId: USER, requestedOrg: ORG, digestDate: DATE });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.digest.movement).toEqual([]);
      expect(view.digest.headline).toBe("2026-02-10: 2h logged");
    }
  });
});
