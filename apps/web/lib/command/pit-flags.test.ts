import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { assemblePitBoard, type PitBatteryRow, type PitQueueRow, type PitRepairRow } from "../pit";
import { loadCommandPitFlags, pitFlagsFromPitBoard } from "./pit-flags";

const NOW = Date.parse("2026-03-07T18:00:00.000Z");
const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const CTX = { teamKey: "frc254", teamNumber: 254, orgId: ORG };

const repair = (overrides: Partial<PitRepairRow> = {}): PitRepairRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  subsystem: "Drivetrain",
  severity: "degraded",
  symptoms: "Chain skip on right side",
  occurredAt: "2026-03-07T17:40:00.000Z",
  matchKey: "2026txho_qm12",
  recordedBy: USER,
  ...overrides,
});

const battery = (overrides: Partial<PitBatteryRow> = {}): PitBatteryRow => ({
  id: "22222222-2222-4222-8222-222222222222",
  assetTag: "COMP-04",
  status: "active",
  measuredAt: "2026-03-07T17:10:00.000Z",
  voltage: 12.74,
  resistanceMilliohms: 18.2,
  gate: "ready",
  ...overrides,
});

const queueItem = (overrides: Partial<PitQueueRow> = {}): PitQueueRow => ({
  id: "33333333-3333-4333-8333-333333333333",
  subsystem: "Electrical",
  task: "Re-tape Anderson leads",
  dueAt: "2026-03-07T17:00:00.000Z",
  ...overrides,
});

function flagsFromBoard(
  input: Parameters<typeof assemblePitBoard>[0],
  extras: { repeatAlerts?: NonNullable<Parameters<typeof pitFlagsFromPitBoard>[0]["repeatAlerts"]> } = {},
) {
  const board = assemblePitBoard({ now: NOW, ...input });
  return pitFlagsFromPitBoard({ ...board, repeatAlerts: extras.repeatAlerts ?? [] }, CTX);
}

describe("pitFlagsFromPitBoard", () => {
  it("stays empty until real repairs / batteries / queue exist", () => {
    const flags = flagsFromBoard({
      repairs: [],
      batteries: [],
      queue: [],
      nextMatch: null,
    });
    expect(flags).toEqual([]);
  });

  it("never invents a DEMO 15-min turnaround when the board has no schedule", () => {
    const flags = flagsFromBoard({
      repairs: [repair()],
      batteries: [],
      queue: [],
      nextMatch: null,
    });
    expect(flags.length).toBeGreaterThan(0);
    expect(JSON.stringify(flags)).not.toMatch(/DEMO/i);
    expect(JSON.stringify(flags)).not.toMatch(/15\s*-?\s*min/i);
    expect(flags.every((flag) => !/\b15m\b/.test(`${flag.title} ${flag.detail}`))).toBe(true);
  });

  it("does not emit turnaround minutes when only a next-match row is live", () => {
    const flags = flagsFromBoard({
      repairs: [],
      batteries: [],
      queue: [],
      nextMatch: {
        matchKey: "2026txho_qm4",
        compLevel: "qm",
        matchNumber: 4,
        scheduledTime: "2026-03-07T18:15:00.000Z",
      },
    });
    expect(flags).toEqual([]);
    expect(JSON.stringify(flags)).not.toMatch(/DEMO/i);
    expect(JSON.stringify(flags)).not.toMatch(/15m/);
  });

  it("maps a real repair row onto a command flag", () => {
    const flags = flagsFromBoard({
      repairs: [repair({ severity: "safety", symptoms: "Sharp exposed chain" })],
      batteries: [],
      queue: [],
      nextMatch: null,
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      teamKey: "frc254",
      teamNumber: 254,
      severity: "critical",
      title: "Safety issue · Drivetrain",
      source: "pit",
    });
    expect(flags[0]?.detail).toMatch(/Sharp exposed chain/);
    expect(flags[0]?.evidence).toMatch(/Pit Command/);
  });

  it("does not invent battery flags when only the queue flag is live", () => {
    const flags = flagsFromBoard({
      repairs: [],
      batteries: [],
      queue: [queueItem()],
      nextMatch: null,
    });
    expect(flags.some((flag) => flag.source === "battery")).toBe(false);
    expect(flags.some((flag) => flag.source === "maintenance")).toBe(true);
    expect(JSON.stringify(flags)).not.toMatch(/DEMO/i);
  });

  it("maps battery evidence only when the batteries flag is live", () => {
    const flags = flagsFromBoard({
      repairs: [],
      batteries: [battery({ gate: "review", health: "retire", assetTag: "COMP-01" })],
      queue: [],
      nextMatch: null,
    });
    expect(flags.some((flag) => flag.source === "battery")).toBe(true);
    expect(flags.some((flag) => /No match-ready battery|retire threshold/i.test(flag.title))).toBe(
      true,
    );
    expect(flags.every((flag) => flag.source !== "maintenance")).toBe(true);
  });

  it("maps overdue queue items from the board summary", () => {
    const flags = flagsFromBoard({
      repairs: [],
      batteries: [],
      queue: [queueItem()],
      nextMatch: null,
    });
    expect(flags[0]).toMatchObject({
      source: "maintenance",
      severity: "warning",
      title: "1 maintenance item overdue",
    });
    expect(flags[0]?.detail).toMatch(/Re-tape Anderson leads/);
  });

  it("maps repeat-failure alerts from the board, not invented counts", () => {
    const flags = flagsFromBoard(
      {
        repairs: [repair()],
        batteries: [],
        queue: [],
        nextMatch: null,
      },
      {
        repeatAlerts: [
          {
            subsystemName: "Intake",
            subsystemId: null,
            failureCount: 3,
            openCount: 1,
            distinctModes: 2,
            maxRpn: 120,
            level: "high",
            message: "Intake has failed 3 times this season",
            recentTitles: ["Belt slip"],
            href: "/fmea",
          },
        ],
      },
    );
    const repeat = flags.find((flag) => flag.source === "fmea_repeat");
    expect(repeat?.title).toBe("Intake has failed 3 times this season");
    expect(repeat?.severity).toBe("critical");
    expect(repeat?.detail).toMatch(/Belt slip/);
  });
});

type Handler = (sql: string, params: unknown[]) => { rows: unknown[] };

function makeClient(handler: Handler): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const result = handler(sql, params);
      return { rowCount: result.rows.length, ...result };
    }),
  } as unknown as PoolClient;
}

describe("loadCommandPitFlags", () => {
  const member = { role: "admin", name: "Vantage", teamNumber: 254 };

  it("returns no flags when Pit Command has no repairs / batteries / queue", async () => {
    const flags = await loadCommandPitFlags(
      makeClient(() => ({ rows: [] })),
      { orgId: ORG, userId: USER, member, teamKey: "frc254", now: new Date(NOW) },
    );
    expect(flags).toEqual([]);
    expect(JSON.stringify(flags)).not.toMatch(/DEMO/i);
  });

  it("imports live Pit Command rows as command flags", async () => {
    const flags = await loadCommandPitFlags(
      makeClient((sql) => {
        if (sql.includes("FROM organizations")) {
          return { rows: [{ eventKey: "2026txho", eventName: "Houston" }] };
        }
        if (sql.includes("FROM maintenance_items")) {
          return {
            rows: [
              {
                id: "33333333-3333-4333-8333-333333333333",
                subsystem: "Electrical",
                task: "Re-tape Anderson leads",
                dueAt: "2026-03-07T17:00:00.000Z",
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
                severity: "disabled",
                symptoms: "Gearbox locked",
                occurredAt: "2026-03-07T17:40:00.000Z",
                matchKey: "2026txho_qm12",
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
        return { rows: [] };
      }),
      { orgId: ORG, userId: USER, member, teamKey: "frc254", now: new Date(NOW) },
    );
    expect(flags.some((flag) => flag.source === "pit" && /Drivetrain/.test(flag.title))).toBe(true);
    expect(flags.some((flag) => flag.source === "maintenance")).toBe(true);
    expect(JSON.stringify(flags)).not.toMatch(/DEMO/i);
  });
});
