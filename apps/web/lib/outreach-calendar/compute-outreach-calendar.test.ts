import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { outreachEventToImpactActivity } from ".";
import { completeOutreachEvent, computeOutreachCalendarView } from "./compute-outreach-calendar";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeOutreachCalendarView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeOutreachCalendarView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with summary and upcoming ordering built from planned events", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM outreach_calendar_events") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "evt-1",
              title: "Elementary STEM night",
              category: "stem_demo",
              scheduledOn: "2026-09-10",
              status: "planned",
              audience: "k12",
              projectedHours: "8",
              projectedPeopleReached: 150,
              location: "Lincoln Elementary",
              notes: null,
              seasonYear: 2026,
            },
            {
              id: "evt-2",
              title: "Robot demo at library",
              category: "community_event",
              scheduledOn: "2026-08-01",
              status: "confirmed",
              audience: "public",
              projectedHours: "4",
              projectedPeopleReached: 60,
              location: "Public library",
              notes: null,
              seasonYear: 2026,
            },
            {
              id: "evt-3",
              title: "Canceled outreach day",
              category: "mentoring",
              scheduledOn: "2026-07-01",
              status: "canceled",
              audience: "other_teams",
              projectedHours: "2",
              projectedPeopleReached: 10,
              location: null,
              notes: null,
              seasonYear: 2026,
            },
          ],
        };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeOutreachCalendarView(client, {
      userId: USER,
      requestedOrg: ORG,
      seasonYear: 2026,
      now: new Date("2026-07-15T00:00:00Z"),
    });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.events).toHaveLength(3);
    // Canceled events are excluded from totals but still returned in the raw list.
    expect(view.summary.totalEvents).toBe(2);
    expect(view.summary.canceledEvents).toBe(1);
    expect(view.summary.totalProjectedHours).toBe(12);
    expect(view.summary.totalProjectedPeopleReached).toBe(210);
    // The earlier upcoming event (library, Aug 1) should sort before the later one (STEM night, Sep 10).
    expect(view.upcoming[0]?.id).toBe("evt-2");
    expect(view.upcoming[1]?.id).toBe("evt-1");
    expect(view.summary.projectedImpactScore).toBeGreaterThan(0);
    expect(view.seasons).toContain(2026);
    // Nothing logged to Impact yet — the client shows the "Complete & log" button, not a badge.
    expect(view.events.every((event) => event.impactActivityId === null)).toBe(true);
  });
});

const EVENT_ROW = {
  id: "evt-1",
  title: "Elementary STEM night",
  category: "stem_demo",
  scheduledOn: "2026-09-10",
  status: "confirmed",
  audience: "k12",
  projectedHours: "8",
  projectedPeopleReached: 150,
  location: "Lincoln Elementary",
  notes: "Two robots, three stations",
  seasonYear: 2026,
  impactActivityId: null as string | null,
};

describe("outreachEventToImpactActivity", () => {
  it("maps a planned event onto the impact_activities shape using projections by default", () => {
    const activity = outreachEventToImpactActivity({
      ...EVENT_ROW,
      category: "fundraising",
      status: "confirmed",
      audience: "public",
      projectedHours: 2.5,
      projectedPeopleReached: 40,
      impactActivityId: null,
    });
    expect(activity.category).toBe("other"); // fundraising is not community outreach
    expect(activity.durationMinutes).toBe(150);
    expect(activity.peopleReached).toBe(40);
    expect(activity.occurredOn).toBe("2026-09-10");
    expect(activity.description).toBe("Two robots, three stations");
  });

  it("honors supplied actuals, including a real zero", () => {
    const activity = outreachEventToImpactActivity(
      { ...EVENT_ROW, status: "confirmed", category: "stem_demo", audience: "k12", projectedHours: 8, projectedPeopleReached: 150, impactActivityId: null },
      { actualHours: 3, actualPeopleReached: 0, participantCount: 6 },
    );
    expect(activity.durationMinutes).toBe(180);
    expect(activity.peopleReached).toBe(0);
    expect(activity.participantCount).toBe(6);
  });
});

describe("completeOutreachEvent", () => {
  it("writes the impact_activities row, links it back, and marks the event completed", async () => {
    const writes: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM outreach_calendar_events") && sql.includes("FOR UPDATE")) {
        return { rows: [EVENT_ROW] };
      }
      if (sql.includes("INSERT INTO impact_activities")) {
        writes.push({ sql, params });
        return { rows: [{ id: "act-1" }] };
      }
      if (sql.includes("UPDATE outreach_calendar_events")) {
        writes.push({ sql, params });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });

    const result = await completeOutreachEvent(client, {
      orgId: ORG,
      userId: USER,
      eventId: "evt-1",
      actualPeopleReached: 120,
    });

    expect(result).toEqual({ impactActivityId: "act-1", created: true });
    const insert = writes.find((w) => w.sql.includes("INSERT INTO impact_activities"));
    expect(insert?.params).toEqual([
      ORG,
      "Elementary STEM night",
      "stem_demo",
      "2026-09-10",
      480,
      0,
      120,
      "k12",
      "Lincoln Elementary",
      "Two robots, three stations",
      2026,
      USER,
    ]);
    const link = writes.find((w) => w.sql.includes("impact_activity_id = $3"));
    expect(link?.params).toEqual(["evt-1", ORG, "act-1"]);
  });

  it("is idempotent: an event that already logged an activity logs nothing twice", async () => {
    const writes: string[] = [];
    const client = makeClient((sql) => {
      if (sql.includes("FROM outreach_calendar_events") && sql.includes("FOR UPDATE")) {
        return { rows: [{ ...EVENT_ROW, status: "completed", impactActivityId: "act-existing" }] };
      }
      if (sql.startsWith("INSERT") || sql.includes("INSERT INTO")) writes.push(sql);
      return { rows: [], rowCount: 0 };
    });

    const result = await completeOutreachEvent(client, { orgId: ORG, userId: USER, eventId: "evt-1" });

    expect(result).toEqual({ impactActivityId: "act-existing", created: false });
    expect(writes).toHaveLength(0);
  });
});
