import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import {
  computeMeetingAutopilotView,
  draftMinutesActionItems,
  generateAgenda,
  saveMinutes,
} from "./compute-meeting-autopilot";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const AGENDA_ID = "33333333-3333-4333-8333-333333333333";
const EVENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

const meetingRow = {
  id: EVENT,
  title: "Weekly build sync",
  startsAt: "2026-07-18T22:30:00.000Z",
  endsAt: "2026-07-18T23:30:00.000Z",
  location: "Shop",
  kind: "meeting",
};

function sourceHandlers(sql: string): { rows: unknown[] } | null {
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
      rows: [{ id: "t1", title: "Wire climber motor controller", subsystem: "Climber", dueOn: "2026-07-01", priority: "critical" }],
    };
  }
  if (sql.includes("FROM decision_records")) {
    return {
      rows: [{ id: "d1", title: "Belt vs chain drivetrain", category: "design", createdAt: "2026-07-10T00:00:00.000Z" }],
    };
  }
  if (sql.includes("FROM fmea_failures")) {
    return {
      rows: [{ id: "f1", title: "Shooter hood jams", subsystemName: "Shooter", severity: 8, occurrence: 4, detection: 3 }],
    };
  }
  return null;
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

  it("returns empty when the org has sources but no calendar meeting", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      const sources = sourceHandlers(sql);
      if (sources) return sources;
      if (sql.includes("FROM subteam_calendar_events")) return { rows: [] };
      if (sql.includes("FROM meeting_autopilot_agendas")) return { rows: [] };
      if (sql.includes("FROM meeting_autopilot_action_items")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeMeetingAutopilotView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("empty");
    if (view.status !== "empty") throw new Error("expected empty view");
    expect(view.orgId).toBe(ORG);
    expect(view.message).toMatch(/empty until a meeting exists/i);
    expect(view.steps.some((step) => step.href.includes("tab=calendar"))).toBe(true);
  });

  it("returns a live view attached to the calendar meeting, with null minutes until written", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      const sources = sourceHandlers(sql);
      if (sources) return sources;
      if (sql.includes("FROM subteam_calendar_events") && sql.includes("DISTINCT")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      if (sql.includes("FROM subteam_calendar_events")) {
        return { rows: [meetingRow] };
      }
      if (sql.includes("FROM meeting_autopilot_agendas") && sql.includes("DISTINCT")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      if (sql.includes("FROM meeting_autopilot_agendas")) {
        return {
          rows: [
            {
              id: AGENDA_ID,
              seasonYear: 2026,
              title: "Weekly build sync",
              meetingOn: "2026-07-18",
              calendarEventId: EVENT,
              agendaItems: {
                minutesText: null,
                items: [
                  {
                    kind: "blocker",
                    sourceId: "b1",
                    title: "Waiting on vendor belt",
                    detail: "Intake — Awaiting supplier shipment",
                    weight: 1020,
                  },
                ],
              },
              blockerCount: 1,
              overdueTaskCount: 1,
              decisionCount: 1,
              fmeaCount: 1,
              status: "draft",
              createdAt: "2026-07-18T00:00:00.000Z",
              updatedAt: "2026-07-18T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM meeting_autopilot_action_items")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeMeetingAutopilotView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.meetings).toHaveLength(1);
    expect(view.meetings[0]!.id).toBe(EVENT);
    expect(view.meetings[0]!.agenda?.id).toBe(AGENDA_ID);
    expect(view.meetings[0]!.agenda?.calendarEventId).toBe(EVENT);
    expect(view.meetings[0]!.minutesText).toBeNull();
    expect(view.meetings[0]!.agenda?.minutesText).toBeNull();
    expect(JSON.stringify(view)).not.toMatch(/DEMO minutes/i);
    expect(view.sourceCounts).toEqual({ blockers: 1, overdueTasks: 1, decisions: 1, fmea: 1 });
    expect(view.liveAgendaItems[0]!.kind).toBe("blocker");
  });
});

describe("generateAgenda", () => {
  it("refuses to persist when the calendar meeting does not exist", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM subteam_calendar_events")) return { rows: [] };
      return { rows: [] };
    });

    await expect(
      generateAgenda(client, { orgId: ORG, userId: USER, seasonYear: 2026, calendarEventId: EVENT }),
    ).rejects.toThrow(/Meeting not found on the calendar/);
  });

  it("persists a deterministic agenda snapshot against the calendar event", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM subteam_calendar_events") && sql.includes("id =")) {
        return { rows: [meetingRow] };
      }
      const sources = sourceHandlers(sql);
      if (sources) return sources;
      if (sql.includes("INSERT INTO ai_usage_events")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("agenda_items->>'calendarEventId'")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO meeting_autopilot_agendas")) {
        inserted.push({ sql, params });
        return { rows: [{ id: AGENDA_ID }] };
      }
      return { rows: [] };
    });

    const agendaId = await generateAgenda(client, {
      orgId: ORG,
      userId: USER,
      seasonYear: 2026,
      calendarEventId: EVENT,
    });

    expect(agendaId).toBe(AGENDA_ID);
    const agendaInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO meeting_autopilot_agendas"));
    expect(agendaInsert).toBeDefined();
    expect(agendaInsert?.params[2]).toBe("Weekly build sync");
    expect(agendaInsert?.params[3]).toBe("2026-07-18");
    expect(agendaInsert?.params[4]).toBe(EVENT);
    expect(agendaInsert?.params[6]).toBe(1);
    expect(agendaInsert?.params[7]).toBe(1);
    const payload = JSON.parse(String(agendaInsert?.params[5]));
    expect(payload.calendarEventId).toBeUndefined();
    expect(payload.minutesText).toBeNull();
    expect(payload.items[0]?.kind).toBe("blocker");

    const usageInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO ai_usage_events"));
    expect(usageInsert).toBeDefined();
  });
});

describe("saveMinutes", () => {
  it("persists authored minutes against the calendar event without inventing DEMO notes", async () => {
    const written: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM subteam_calendar_events") && sql.includes("id =")) {
        return { rows: [meetingRow] };
      }
      if (sql.includes("agenda_items->>'calendarEventId'")) {
        return {
          rows: [
            {
              id: AGENDA_ID,
              seasonYear: 2026,
              title: "Weekly build sync",
              meetingOn: "2026-07-18",
              calendarEventId: EVENT,
              agendaItems: { minutesText: null, items: [] },
              blockerCount: 0,
              overdueTaskCount: 0,
              decisionCount: 0,
              fmeaCount: 0,
              status: "draft",
              createdAt: "2026-07-18T00:00:00.000Z",
              updatedAt: "2026-07-18T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("UPDATE meeting_autopilot_agendas")) {
        written.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    const saved = await saveMinutes(client, {
      orgId: ORG,
      userId: USER,
      seasonYear: 2026,
      calendarEventId: EVENT,
      minutesText: "- Order replacement belt @Alex due 2026-07-25",
    });

    expect(saved).toEqual({ agendaId: AGENDA_ID, calendarEventId: EVENT });
    const update = written.find((entry) => entry.sql.includes("UPDATE meeting_autopilot_agendas"));
    expect(update).toBeDefined();
    expect(update?.params[2]).toBe(EVENT);
    const payload = JSON.parse(String(update?.params[3]));
    expect(payload.calendarEventId).toBeUndefined();
    expect(payload.minutesText).toBe("- Order replacement belt @Alex due 2026-07-25");
    expect(payload.minutesText).not.toMatch(/^DEMO/i);
  });

  it("refuses minutes that are not attached to a calendar meeting", async () => {
    const client = makeClient(() => ({ rows: [] }));
    await expect(
      saveMinutes(client, { orgId: ORG, userId: USER, seasonYear: 2026, minutesText: "notes" }),
    ).rejects.toThrow(/calendarEventId is required/);
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
