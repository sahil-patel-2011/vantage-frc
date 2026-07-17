import { describe, expect, it } from "vitest";
import {
  memberLeaderboard,
  parseBuildHoursAction,
  recordHours,
  summarizeHours,
  validateManualRange,
  type HourLog,
  type HourMember,
} from "./build-hours";

const ORG = "11111111-1111-4111-8111-111111111111";
const U1 = "22222222-2222-4222-8222-222222222222";
const U2 = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-02-01T20:00:00.000Z").getTime();

function record(overrides: Partial<HourLog>): HourLog {
  return {
    id: "r1",
    userId: U1,
    userName: "Ada",
    kind: "build",
    clockIn: "2026-02-01T17:00:00.000Z",
    clockOut: "2026-02-01T19:00:00.000Z",
    note: "",
    closedByName: null,
    ...overrides,
  };
}

const members: HourMember[] = [
  { userId: U1, name: "Ada", role: "scout" },
  { userId: U2, name: "Grace", role: "admin" },
];

describe("recordHours", () => {
  it("computes closed-session hours", () => {
    expect(recordHours(record({}), NOW)).toBe(2);
  });
  it("counts open sessions up to now and guards bad ranges", () => {
    expect(recordHours(record({ clockIn: "2026-02-01T19:00:00.000Z", clockOut: null }), NOW)).toBe(1);
    expect(recordHours(record({ clockIn: "bad", clockOut: null }), NOW)).toBe(0);
  });
});

describe("memberLeaderboard", () => {
  it("ranks by total hours, includes zero-hour members, and marks open sessions", () => {
    const rows = memberLeaderboard(
      [
        record({ id: "a", userId: U1 }), // 2h closed
        record({ id: "b", userId: U1, clockIn: "2026-02-01T19:30:00.000Z", clockOut: null }), // 0.5h open
      ],
      members,
      10,
      NOW,
    );
    expect(rows[0]).toMatchObject({ userId: U1, name: "Ada", totalHours: 2.5, sessions: 2, openRecordId: "b", goalPercent: 25 });
    expect(rows[1]).toMatchObject({ userId: U2, totalHours: 0, sessions: 0, openRecordId: null });
  });
  it("returns null goalPercent with no goal and caps at 100", () => {
    const noGoal = memberLeaderboard([record({})], members, 0, NOW);
    expect(noGoal[0]!.goalPercent).toBeNull();
    const capped = memberLeaderboard([record({})], members, 1, NOW);
    expect(capped[0]!.goalPercent).toBe(100);
  });
});

describe("summarizeHours", () => {
  it("counts here-now, totals, and averages", () => {
    const summary = summarizeHours(
      [
        record({ id: "a", userId: U1 }), // 2h
        record({ id: "b", userId: U2, clockIn: "2026-02-01T18:00:00.000Z", clockOut: null }), // 2h open
      ],
      NOW,
    );
    expect(summary.hereNow).toBe(1);
    expect(summary.totalHours).toBe(4);
    expect(summary.activeMembers).toBe(2);
    expect(summary.avgHours).toBe(2);
  });
});

describe("validateManualRange", () => {
  it("rejects out-before-in and >24h marathons", () => {
    expect(() => validateManualRange("2026-02-01T19:00:00Z", "2026-02-01T18:00:00Z")).toThrow(/after clock-in/);
    expect(() => validateManualRange("2026-02-01T00:00:00Z", "2026-02-02T01:00:00Z")).toThrow(/24 hours/);
    expect(() => validateManualRange("2026-02-01T17:00:00Z", "2026-02-01T20:00:00Z")).not.toThrow();
  });
});

describe("parseBuildHoursAction", () => {
  it("clock_in defaults kind to build and self-target", () => {
    expect(parseBuildHoursAction({ action: "clock_in", orgId: ORG })).toMatchObject({ action: "clock_in", kind: "build", note: "", userId: null });
    expect(() => parseBuildHoursAction({ action: "clock_in", orgId: ORG, kind: "nap" })).toThrow(/Invalid session kind/);
  });
  it("clock_in accepts a kiosk target member and rejects bad ids", () => {
    expect(parseBuildHoursAction({ action: "clock_in", orgId: ORG, userId: U1 })).toMatchObject({ userId: U1 });
    expect(() => parseBuildHoursAction({ action: "clock_in", orgId: ORG, userId: "nope" })).toThrow(/invalid/i);
  });
  it("clock_out allows self (null record) or a specific record id", () => {
    expect(parseBuildHoursAction({ action: "clock_out", orgId: ORG })).toMatchObject({ recordId: null });
    expect(parseBuildHoursAction({ action: "clock_out", orgId: ORG, recordId: U1 })).toMatchObject({ recordId: U1 });
  });
  it("add_manual validates the time range and normalizes ISO", () => {
    const action = parseBuildHoursAction({
      action: "add_manual",
      orgId: ORG,
      clockIn: "2026-02-01T17:00:00Z",
      clockOut: "2026-02-01T19:00:00Z",
    });
    expect(action).toMatchObject({ action: "add_manual", userId: null, kind: "build" });
    expect(() =>
      parseBuildHoursAction({ action: "add_manual", orgId: ORG, clockIn: "2026-02-01T19:00:00Z", clockOut: "2026-02-01T17:00:00Z" }),
    ).toThrow(/after clock-in/);
  });
  it("set_policy validates the goal and normalizes the date", () => {
    expect(parseBuildHoursAction({ action: "set_policy", orgId: ORG, seasonGoalHours: 100, seasonStart: "2026-01-10" })).toMatchObject({
      seasonGoalHours: 100,
      seasonStart: "2026-01-10",
    });
    expect(() => parseBuildHoursAction({ action: "set_policy", orgId: ORG, seasonGoalHours: -5 })).toThrow(/between 0/);
  });
  it("rejects unsupported actions", () => {
    expect(() => parseBuildHoursAction({ action: "warp", orgId: ORG })).toThrow(/Unsupported/);
  });
});
