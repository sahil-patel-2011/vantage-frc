import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeMeetingAutopilotView, draftMinutesActionItems, generateAgenda } from "./compute-meeting-autopilot";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const AGENDA_ID = "33333333-3333-4333-8333-333333333333";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeMeetingAutopilotView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeMeetingAutopilotView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with a ranked agenda built from blockers/overdue tasks/decisions/FMEA", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM build_tasks") && sql.includes("status = 'blocked'")) {
        return {
          rows: [
            {
              id: "b1",
              title: "Waiting on vendor belt",
              subsystem: "Intake",
              blockedReason: "Awaiting supplier shipment",
              priority: "high",
            },
          ],
        };
      }
      if (sql.includes("FROM build_tasks") && sql.includes("due_on < current_date")) {
        return {
          rows: [
            { id: "t1", title: "Wire climber motor controller", subsystem: "Climber", dueOn: "2026-07-01", priority: "critical" },
          ],
        };
      }
      if (sql.includes("FROM decision_records")) {
        return {
          rows: [{ id: "d1", title: "Belt vs chain drivetrain", category: "design", createdAt: "2026-07-10T00:00:00.000Z" }],
        };
      }
      if (sql.includes("FROM fmea_failures")) {
        return {
          rows: [
            { id: "f1", title: "Shooter hood jams", subsystemName: "Shooter", severity: 8, occurrence: 4, detection: 3 },
          ],
        };
      }
      if (sql.includes("FROM meeting_autopilot_agendas") && sql.includes("DISTINCT")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      if (sql.includes("FROM meeting_autopilot_agendas")) {
        return { rows: [] };
      }
      if (sql.includes("FROM meeting_autopilot_action_items")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const view = await computeMeetingAutopilotView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.sourceCounts).toEqual({ blockers: 1, overdueTasks: 1, decisions: 1, fmea: 1 });
    expect(view.liveAgendaItems).toHaveLength(4);
    // Blockers always outrank overdue tasks, decisions, and FMEA in the ranked agenda.
    expect(view.liveAgendaItems[0]!.kind).toBe("blocker");
    expect(view.seasons).toContain(2026);
  });
});

describe("generateAgenda", () => {
  it("persists a deterministic agenda snapshot grounded in the live source rows", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM build_tasks") && sql.includes("status = 'blocked'")) {
        return { rows: [{ id: "b1", title: "Missing bearings", subsystem: "Drivetrain", blockedReason: null, priority: "normal" }] };
      }
      if (sql.includes("FROM build_tasks")) return { rows: [] };
      if (sql.includes("FROM decision_records")) return { rows: [] };
      if (sql.includes("FROM fmea_failures")) return { rows: [] };
      if (sql.includes("INSERT INTO ai_usage_events")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO meeting_autopilot_agendas")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    await generateAgenda(client, {
      orgId: ORG,
      userId: USER,
      seasonYear: 2026,
      title: "Weekly build sync",
      meetingOn: "2026-07-18",
    });

    const agendaInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO meeting_autopilot_agendas"));
    expect(agendaInsert).toBeDefined();
    expect(agendaInsert?.params[5]).toBe(1); // blocker_count
    expect(agendaInsert?.params[6]).toBe(0); // overdue_task_count

    const usageInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO ai_usage_events"));
    expect(usageInsert).toBeDefined();
  });
});

describe("draftMinutesActionItems", () => {
  it("parses bulleted minutes lines into persisted action items", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("INSERT INTO ai_usage_events")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO meeting_autopilot_action_items")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    const minutes = [
      "Meeting started at 6pm with 12 members present.",
      "- Order replacement belt @Alex due 2026-07-25",
      "TODO: Finish wiring diagram review",
      "General discussion about scouting schedule.",
    ].join("\n");

    const count = await draftMinutesActionItems(client, {
      orgId: ORG,
      userId: USER,
      agendaId: AGENDA_ID,
      minutesText: minutes,
    });

    expect(count).toBe(2);
    const itemInserts = inserted.filter((entry) => entry.sql.includes("INSERT INTO meeting_autopilot_action_items"));
    expect(itemInserts).toHaveLength(2);
    expect(itemInserts[0]?.params[2]).toBe("Order replacement belt");
    expect(itemInserts[0]?.params[3]).toBe("Alex");
    expect(itemInserts[0]?.params[4]).toBe("2026-07-25");
  });
});
