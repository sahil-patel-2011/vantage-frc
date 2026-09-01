import { describe, expect, it } from "vitest";
import {
  assemblePitBoard,
  classifyPitBoardFlags,
  isPitBoardLive,
  pitBoardGate,
  pitTurnaroundFromSchedule,
  pitTurnaroundLabel,
  type PitBatteryRow,
  type PitQueueRow,
  type PitRepairRow,
} from "./board";

const NOW = Date.parse("2026-03-07T18:00:00.000Z");

const repair = (overrides: Partial<PitRepairRow> = {}): PitRepairRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  subsystem: "Drivetrain",
  severity: "degraded",
  symptoms: "Chain skip on right side",
  occurredAt: "2026-03-07T17:40:00.000Z",
  matchKey: "2026txho_qm12",
  recordedBy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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
  dueAt: "2026-03-07T18:30:00.000Z",
  ...overrides,
});

describe("classifyPitBoardFlags", () => {
  it("stays empty until a real repairs / batteries / queue row exists", () => {
    const flags = classifyPitBoardFlags({
      repairRows: 0,
      batteryRows: 0,
      queueRows: 0,
    });
    expect(flags).toEqual({ repairs: false, batteries: false, queue: false });
    expect(isPitBoardLive(flags)).toBe(false);
  });

  it("sets live flags only from real row counts", () => {
    expect(
      classifyPitBoardFlags({ repairRows: 1, batteryRows: 0, queueRows: 0 }),
    ).toEqual({ repairs: true, batteries: false, queue: false });
    expect(
      classifyPitBoardFlags({ repairRows: 0, batteryRows: 2, queueRows: 0 }),
    ).toEqual({ repairs: false, batteries: true, queue: false });
    expect(
      classifyPitBoardFlags({ repairRows: 0, batteryRows: 0, queueRows: 1 }),
    ).toEqual({ repairs: false, batteries: false, queue: true });
  });

  it("treats a real next-match row as queue evidence", () => {
    const flags = classifyPitBoardFlags({
      repairRows: 0,
      batteryRows: 0,
      queueRows: 0,
      hasNextMatch: true,
    });
    expect(flags.queue).toBe(true);
    expect(isPitBoardLive(flags)).toBe(true);
  });
});

describe("pitTurnaroundFromSchedule", () => {
  it("returns null without a real scheduled time — never a DEMO 15m turnaround", () => {
    expect(pitTurnaroundFromSchedule(null, NOW)).toBeNull();
    expect(pitTurnaroundFromSchedule("", NOW)).toBeNull();
    expect(pitTurnaroundFromSchedule("not-a-date", NOW)).toBeNull();
    expect(pitTurnaroundLabel(null)).toBeNull();
  });

  it("computes remaining time from a real scheduled match", () => {
    const turnaround = pitTurnaroundFromSchedule("2026-03-07T18:12:00.000Z", NOW);
    expect(turnaround).toEqual({ minutes: 12, seconds: 0, overdue: false });
    expect(pitTurnaroundLabel(turnaround)).toBe("12m 0s");
  });

  it("marks overdue when the real scheduled time has passed", () => {
    const turnaround = pitTurnaroundFromSchedule("2026-03-07T17:59:00.000Z", NOW);
    expect(turnaround).toEqual({ minutes: 0, seconds: 0, overdue: true });
    expect(pitTurnaroundLabel(turnaround)).toBe("Queue now");
  });
});

describe("pitBoardGate", () => {
  it("stays empty when no flags are live — does not invent a CHECK from missing batteries", () => {
    expect(
      pitBoardGate({
        flags: { repairs: false, batteries: false, queue: false },
        safetyIssues: 0,
        disabledIssues: 0,
        overdueMaintenance: 0,
        readyBatteries: 0,
        activeBatteries: 0,
      }),
    ).toEqual({ state: "empty", reasons: [] });
  });

  it("does not invent a battery CHECK when only the queue flag is live", () => {
    const gate = pitBoardGate({
      flags: { repairs: false, batteries: false, queue: true },
      safetyIssues: 0,
      disabledIssues: 0,
      overdueMaintenance: 0,
      readyBatteries: 0,
      activeBatteries: 0,
    });
    expect(gate.state).toBe("go");
    expect(gate.reasons.join(" ")).not.toMatch(/battery/i);
    expect(JSON.stringify(gate)).not.toMatch(/DEMO/i);
  });

  it("holds on real safety / disabled repairs once the repairs flag is live", () => {
    expect(
      pitBoardGate({
        flags: { repairs: true, batteries: false, queue: false },
        safetyIssues: 1,
        disabledIssues: 0,
        overdueMaintenance: 0,
        readyBatteries: 0,
        activeBatteries: 0,
      }).state,
    ).toBe("hold");
  });
});

describe("assemblePitBoard empty vs live", () => {
  it("returns an empty board with no DEMO turnaround when every source is blank", () => {
    const board = assemblePitBoard({
      repairs: [],
      batteries: [],
      queue: [],
      nextMatch: null,
      now: NOW,
    });
    expect(board.status).toBe("empty");
    expect(board.flags).toEqual({ repairs: false, batteries: false, queue: false });
    expect(board.repairs).toEqual([]);
    expect(board.batteries).toEqual([]);
    expect(board.queue).toEqual([]);
    expect(board.issues).toEqual([]);
    expect(board.maintenance).toEqual([]);
    expect(board.turnaround).toBeNull();
    expect(board.gate.state).toBe("empty");
    expect(board.summary).toEqual({
      openIssues: 0,
      overdueMaintenance: 0,
      readyBatteries: 0,
      activeBatteries: 0,
    });
    expect(JSON.stringify(board)).not.toMatch(/DEMO/i);
  });

  it("goes live from a real repair row and still withholds turnaround", () => {
    const board = assemblePitBoard({
      repairs: [repair()],
      batteries: [],
      queue: [],
      nextMatch: null,
      now: NOW,
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(board.status).toBe("live");
    expect(board.flags.repairs).toBe(true);
    expect(board.issues).toHaveLength(1);
    expect(board.issues[0]?.canResolve).toBe(true);
    expect(board.turnaround).toBeNull();
    expect(board.gate.state).not.toBe("empty");
  });

  it("goes live from a real battery row and reports ready/active from that pack", () => {
    const board = assemblePitBoard({
      repairs: [],
      batteries: [battery(), battery({ id: "retired", status: "retired", assetTag: "OLD" })],
      queue: [],
      nextMatch: null,
      now: NOW,
    });
    expect(board.flags).toEqual({ repairs: false, batteries: true, queue: false });
    expect(board.batteries.map((row) => row.assetTag)).toEqual(["COMP-04"]);
    expect(board.summary.readyBatteries).toBe(1);
    expect(board.summary.activeBatteries).toBe(1);
  });

  it("goes live from a real work-queue row", () => {
    const board = assemblePitBoard({
      repairs: [],
      batteries: [],
      queue: [queueItem({ dueAt: "2026-03-07T17:00:00.000Z" })],
      nextMatch: null,
      now: NOW,
    });
    expect(board.flags.queue).toBe(true);
    expect(board.maintenance).toHaveLength(1);
    expect(board.summary.overdueMaintenance).toBe(1);
    expect(board.gate.state).toBe("check");
    expect(board.turnaround).toBeNull();
  });

  it("computes turnaround only from a real next-match schedule — never DEMO 15m", () => {
    const withTime = assemblePitBoard({
      repairs: [],
      batteries: [],
      queue: [],
      nextMatch: {
        matchKey: "2026txho_qm4",
        compLevel: "qm",
        matchNumber: 4,
        scheduledTime: "2026-03-07T18:15:00.000Z",
      },
      now: NOW,
    });
    expect(withTime.status).toBe("live");
    expect(withTime.flags.queue).toBe(true);
    expect(withTime.turnaround).toEqual({ minutes: 15, seconds: 0, overdue: false });
    expect(pitTurnaroundLabel(withTime.turnaround)).toBe("15m 0s");

    const noTime = assemblePitBoard({
      repairs: [],
      batteries: [],
      queue: [],
      nextMatch: {
        matchKey: "2026txho_qm4",
        compLevel: "qm",
        matchNumber: 4,
        scheduledTime: null,
      },
      now: NOW,
    });
    expect(noTime.flags.queue).toBe(true);
    expect(noTime.turnaround).toBeNull();
    expect(pitTurnaroundLabel(noTime.turnaround)).toBeNull();
    expect(JSON.stringify(noTime)).not.toMatch(/DEMO/i);
  });
});
