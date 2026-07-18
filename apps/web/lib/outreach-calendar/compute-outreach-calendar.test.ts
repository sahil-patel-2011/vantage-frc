import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeOutreachCalendarView } from "./compute-outreach-calendar";

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
  });
});
