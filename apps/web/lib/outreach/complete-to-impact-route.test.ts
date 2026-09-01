import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/outreach-calendar complete-to-impact contract.
 * Completing an event must write impact_activities; planned/confirmed stay empty.
 */

const state = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  calls: [] as Array<{ sql: string; params: unknown[] }>,
  event: {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Elementary STEM night",
    category: "stem_demo",
    scheduledOn: "2026-09-10",
    status: "planned",
    audience: "k12",
    projectedHours: 8,
    projectedPeopleReached: 150,
    location: "Lincoln Elementary",
    notes: null,
    seasonYear: 2026,
  } as Record<string, unknown>,
  existingActivityId: null as string | null,
  member: true,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => state.session } },
}));

vi.mock("@vantage/db", () => ({
  withRls: async (_context: unknown, work: (client: unknown) => Promise<unknown>) =>
    work({
      query: async (sql: string, params: unknown[] = []) => {
        state.calls.push({ sql, params });
        if (sql.includes("FROM memberships")) {
          return { rows: state.member ? [{}] : [], rowCount: state.member ? 1 : 0 };
        }
        if (sql.includes("FROM outreach_calendar_events") && sql.includes("WHERE id = $1")) {
          return { rows: [state.event], rowCount: 1 };
        }
        if (sql.includes("FROM outreach_calendar_events") && sql.includes("ORDER BY created_at")) {
          return { rows: [{ id: state.event.id }], rowCount: 1 };
        }
        if (sql.includes("FROM impact_activities") && sql.includes("source_event_id")) {
          return state.existingActivityId
            ? { rows: [{ id: state.existingActivityId }], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        }
        if (sql.includes("FROM impact_activities") && sql.includes("description LIKE")) {
          return state.existingActivityId
            ? { rows: [{ id: state.existingActivityId }], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        }
        if (sql.includes("INSERT INTO impact_activities")) {
          return { rows: [{ id: "act-from-complete" }], rowCount: 1 };
        }
        if (sql.includes("UPDATE outreach_calendar_events")) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    }),
}));

vi.mock("../../lib/outreach-calendar/compute-outreach-calendar", () => ({
  currentSeasonYear: () => 2026,
  computeOutreachCalendarView: async () => ({
    status: "live",
    orgId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    teamNumber: 254,
    seasonYear: 2026,
    seasons: [2026],
    events: [],
    upcoming: [],
    summary: {
      totalEvents: 1,
      plannedEvents: 0,
      confirmedEvents: 0,
      completedEvents: 1,
      canceledEvents: 0,
      totalProjectedHours: 8,
      totalProjectedPeopleReached: 150,
      completedProjectedHours: 8,
      completedProjectedPeopleReached: 150,
      byCategory: [],
      byMonth: [],
      projectedImpactScore: 0,
    },
    computedAt: "2026-08-31T00:00:00.000Z",
  }),
  createOutreachEvent: async () => undefined,
  updateOutreachEventStatus: async () => undefined,
  deleteOutreachEvent: async () => undefined,
}));

const { POST } = await import("../../app/api/outreach-calendar/route");

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/outreach-calendar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  state.session = { user: { id: USER } };
  state.calls = [];
  state.member = true;
  state.existingActivityId = null;
  state.event = {
    id: EVENT_ID,
    title: "Elementary STEM night",
    category: "stem_demo",
    scheduledOn: "2026-09-10",
    status: "planned",
    audience: "k12",
    projectedHours: 8,
    projectedPeopleReached: 150,
    location: "Lincoln Elementary",
    notes: null,
    seasonYear: 2026,
  };
});

describe("POST /api/outreach-calendar complete-to-impact", () => {
  it("returns 401 when there is no session", async () => {
    state.session = null;
    const response = await post({ action: "complete", orgId: ORG, eventId: EVENT_ID });
    expect(response.status).toBe(401);
  });

  it("writes impact_activities when action is complete", async () => {
    const response = await post({ action: "complete", orgId: ORG, eventId: EVENT_ID });
    expect(response.status).toBe(200);
    expect(state.calls.some((call) => call.sql.includes("INSERT INTO impact_activities"))).toBe(true);
    const insert = state.calls.find((call) => call.sql.includes("INSERT INTO impact_activities"))!;
    expect(insert.params[4]).toBe(480);
    expect(insert.params[6]).toBe(150);
  });

  it("writes impact_activities when update-status sets completed", async () => {
    const response = await post({
      action: "update-status",
      orgId: ORG,
      eventId: EVENT_ID,
      status: "completed",
    });
    expect(response.status).toBe(200);
    expect(state.calls.some((call) => call.sql.includes("INSERT INTO impact_activities"))).toBe(true);
  });

  it("stays empty on the impact log when status stays planned", async () => {
    const response = await post({
      action: "update-status",
      orgId: ORG,
      eventId: EVENT_ID,
      status: "planned",
    });
    expect(response.status).toBe(200);
    expect(state.calls.some((call) => call.sql.includes("INSERT INTO impact_activities"))).toBe(false);
  });

  it("stays empty when a new event is scheduled as planned", async () => {
    const response = await post({
      action: "create-event",
      orgId: ORG,
      title: "Elementary STEM night",
      scheduledOn: "2026-09-10",
      category: "stem_demo",
      audience: "k12",
      status: "planned",
      projectedHours: 8,
      projectedPeopleReached: 150,
    });
    expect(response.status).toBe(200);
    expect(state.calls.some((call) => call.sql.includes("INSERT INTO impact_activities"))).toBe(false);
  });

  it("writes impact_activities when a new event is created already completed", async () => {
    state.event = { ...state.event, status: "completed" };
    const response = await post({
      action: "create-event",
      orgId: ORG,
      title: "Elementary STEM night",
      scheduledOn: "2026-09-10",
      category: "stem_demo",
      audience: "k12",
      status: "completed",
      projectedHours: 8,
      projectedPeopleReached: 150,
    });
    expect(response.status).toBe(200);
    expect(state.calls.some((call) => call.sql.includes("INSERT INTO impact_activities"))).toBe(true);
  });
});
