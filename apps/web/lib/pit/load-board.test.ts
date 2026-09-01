import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { loadPitBoard } from "./load-board";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const EVENT = "2026txho";
const NOW = new Date("2026-03-07T18:00:00.000Z");

type Handler = (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number };

function makeClient(handler: Handler): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const result = handler(sql, params);
      return { rowCount: result.rows.length, ...result };
    }),
  } as unknown as PoolClient;
}

function emptyHandler(): Handler {
  return (sql) => {
    if (sql.includes("FROM organizations")) {
      return { rows: [{ eventKey: null, eventName: null }] };
    }
    return { rows: [] };
  };
}

function liveHandler(): Handler {
  return (sql) => {
    if (sql.includes("FROM organizations")) {
      return { rows: [{ eventKey: EVENT, eventName: "Houston" }] };
    }
    if (sql.includes("FROM maintenance_items")) {
      return {
        rows: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            subsystem: "Electrical",
            task: "Re-tape Anderson leads",
            dueAt: "2026-03-07T18:30:00.000Z",
          },
        ],
      };
    }
    if (sql.includes("FROM robot_failures")) {
      return {
        rows: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            subsystem: "Drivetrain",
            severity: "degraded",
            symptoms: "Chain skip",
            occurredAt: "2026-03-07T17:40:00.000Z",
            matchKey: `${EVENT}_qm12`,
            recordedBy: USER,
          },
        ],
      };
    }
    if (sql.includes("FROM battery_packs")) {
      return {
        rows: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            label: "COMP-04",
            status: "active",
            purchaseDate: null,
            measuredAt: "2026-03-07T17:10:00.000Z",
            voltage: 12.74,
            resistanceMilliohms: 18.2,
            cycleCount: 4,
          },
        ],
      };
    }
    if (sql.includes("FROM matches_ref")) {
      return {
        rows: [
          {
            matchKey: `${EVENT}_qm4`,
            compLevel: "qm",
            matchNumber: 4,
            scheduledTime: "2026-03-07T18:12:00.000Z",
          },
        ],
      };
    }
    return { rows: [] };
  };
}

const member = { role: "admin", name: "Vantage", teamNumber: 254 };

describe("loadPitBoard", () => {
  it("polls empty flags when repairs / batteries / queue have no rows", async () => {
    const payload = await loadPitBoard(makeClient(emptyHandler()), {
      orgId: ORG,
      userId: USER,
      member,
      now: NOW,
    });
    expect(payload.status).toBe("empty");
    expect(payload.flags).toEqual({ repairs: false, batteries: false, queue: false });
    expect(payload.repairs).toEqual([]);
    expect(payload.batteries).toEqual([]);
    expect(payload.queue).toEqual([]);
    expect(payload.turnaround).toBeNull();
    expect(payload.gate.state).toBe("empty");
    expect(payload.repeatAlerts).toEqual([]);
    expect(JSON.stringify(payload)).not.toMatch(/DEMO/i);
  });

  it("sets live flags from real repair, battery, and queue rows", async () => {
    const payload = await loadPitBoard(makeClient(liveHandler()), {
      orgId: ORG,
      userId: USER,
      member,
      now: NOW,
    });
    expect(payload.status).toBe("live");
    expect(payload.flags).toEqual({ repairs: true, batteries: true, queue: true });
    expect(payload.issues).toHaveLength(1);
    expect(payload.batteries[0]?.assetTag).toBe("COMP-04");
    expect(payload.maintenance).toHaveLength(1);
    expect(payload.nextMatch?.matchKey).toBe(`${EVENT}_qm4`);
    expect(payload.turnaround).toEqual({ minutes: 12, seconds: 0, overdue: false });
    expect(payload.context.eventKey).toBe(EVENT);
    expect(JSON.stringify(payload)).not.toMatch(/DEMO/i);
  });
});
