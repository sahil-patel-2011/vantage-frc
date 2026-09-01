import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeEventReadinessView } from "./compute-event-readiness";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const PLAN = "22222222-2222-4222-8222-222222222222";

function makeClient(handler: (sql: string) => { rows: unknown[] }): PoolClient {
  return {
    query: vi.fn(async (sql: string) => handler(sql)),
  } as unknown as PoolClient;
}

describe("computeEventReadinessView remaining blockers", () => {
  it("does not invent remaining=0 when the four sources have no rows", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM event_readiness_plans") && sql.includes("event_start_date::text AS \"eventStartDate\"")) {
        return {
          rows: [{ id: PLAN, eventKey: "2026casj", eventName: "Silicon Valley Regional", eventStartDate: "2026-03-12" }],
        };
      }
      if (sql.includes("FROM event_readiness_plans") && sql.includes("travel_departs_at")) {
        return {
          rows: [
            {
              id: PLAN,
              eventKey: "2026casj",
              eventName: "Silicon Valley Regional",
              eventStartDate: "2026-03-12",
              seasonYear: 2026,
              travelDepartsAt: null,
              notes: "",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const view = await computeEventReadinessView(client, {
      userId: USER,
      requestedOrg: ORG,
      eventKey: "2026casj",
      today: "2026-03-05",
    });

    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.remaining).toBeNull();
    expect(view.ready).toBe(false);
    expect(view.blockers.eventStartDate).toBe("2026-03-12");
    expect(view.blockers.unknownSources).toEqual(["inspection", "consent", "packing", "logistics"]);
  });

  it("totals remaining blockers for one event date from the four source snapshots", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM event_readiness_plans") && sql.includes("travel_departs_at")) {
        return {
          rows: [
            {
              id: PLAN,
              eventKey: "2026casj",
              eventName: "Silicon Valley Regional",
              eventStartDate: "2026-03-12",
              seasonYear: 2026,
              travelDepartsAt: null,
              notes: "",
            },
          ],
        };
      }
      if (sql.includes("FROM event_readiness_plans")) {
        return {
          rows: [{ id: PLAN, eventKey: "2026casj", eventName: "Silicon Valley Regional", eventStartDate: "2026-03-12" }],
        };
      }
      if (sql.includes("FROM inspection_items")) return { rows: [{ status: "fail" }, { status: "pass" }] };
      if (sql.includes("FROM consent_records")) {
        return { rows: [{ formId: "med", personName: "Sam", status: "pending" }] };
      }
      if (sql.includes("FROM consent_forms")) return { rows: [{ id: "med", required: true }] };
      if (sql.includes("FROM packing_items")) return { rows: [{ packed: false }, { packed: true }] };
      if (sql.includes("FROM packing_lists")) return { rows: [{ id: "list-1" }] };
      if (sql.includes("FROM logistics_travel_legs")) return { rows: [{ n: 2 }] };
      if (sql.includes("FROM logistics_room_assignments")) {
        return {
          rows: [
            { occupantUserId: null, occupantName: "" },
            { occupantUserId: "u1", occupantName: "Sam" },
          ],
        };
      }
      if (sql.includes("FROM logistics_trips")) return { rows: [{ id: "trip-1" }] };
      return { rows: [] };
    });

    const view = await computeEventReadinessView(client, {
      userId: USER,
      requestedOrg: ORG,
      eventKey: "2026casj",
      today: "2026-03-05",
    });

    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.remaining).toBe(4);
    expect(view.ready).toBe(false);
    expect(view.blockers.eventStartDate).toBe("2026-03-12");
    expect(view.blockers.unknownSources).toEqual([]);
  });
});
