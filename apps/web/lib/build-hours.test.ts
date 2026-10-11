import { describe, expect, it } from "vitest";
import {
  describeSessionRange,
  memberLeaderboard,
  overlapMessage,
  overlappingRecord,
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
    expect(() => validateManualRange("2026-02-01T19:00:00Z", "2026-02-01T18:00:00Z", NOW)).toThrow(/after the start/);
    expect(() => validateManualRange("2026-01-30T00:00:00Z", "2026-01-31T01:00:00Z", NOW)).toThrow(/24 hours/);
    expect(() => validateManualRange("2026-02-01T17:00:00Z", "2026-02-01T20:00:00Z", NOW)).not.toThrow();
  });

  it("refuses hours that have not happened yet (A5-03: Jan 5 2027 was accepted)", () => {
    expect(() => validateManualRange("2027-01-05T10:00:00Z", "2027-01-05T14:00:00Z", NOW)).toThrow(/haven't happened yet/);
    // Ending a little after "now" on a phone whose clock runs fast is still fine.
    expect(() => validateManualRange("2026-02-01T18:00:00Z", "2026-02-01T20:03:00Z", NOW)).not.toThrow();
  });

  it("refuses a session too short to be real (A5-03: a 30-second entry)", () => {
    expect(() => validateManualRange("2026-02-01T17:00:00Z", "2026-02-01T17:00:30Z", NOW)).toThrow(/at least 5 minutes/);
  });
});

describe("overlappingRecord", () => {
  const logged = [
    record({ id: "a", clockIn: "2026-01-30T17:00:00.000Z", clockOut: "2026-01-30T21:00:00.000Z" }),
    record({ id: "open", clockIn: "2026-02-01T19:00:00.000Z", clockOut: null }),
  ];

  it("finds a typed-in session that lands on hours already logged", () => {
    expect(overlappingRecord(logged, { clockIn: "2026-01-30T19:00:00Z", clockOut: "2026-01-30T23:00:00Z" }, NOW)?.id).toBe("a");
  });

  it("treats an open session as running until now", () => {
    expect(overlappingRecord(logged, { clockIn: "2026-02-01T19:30:00Z", clockOut: "2026-02-01T19:45:00Z" }, NOW)?.id).toBe("open");
  });

  it("allows back-to-back sessions and ignores the entry being corrected", () => {
    expect(overlappingRecord(logged, { clockIn: "2026-01-30T21:00:00Z", clockOut: "2026-01-30T22:00:00Z" }, NOW)).toBeNull();
    expect(
      overlappingRecord(logged, { clockIn: "2026-01-30T18:00:00Z", clockOut: "2026-01-30T20:00:00Z", excludeId: "a" }, NOW),
    ).toBeNull();
  });

  it("names the other session in the refusal, in the sender's time zone", () => {
    const message = overlapMessage(logged[0]!, "America/New_York");
    expect(message).toBe(
      "Those hours overlap an entry already logged (Jan 30, 2026, 12:00 PM – 4:00 PM). Change the times, or ask a mentor to correct the other entry.",
    );
    expect(describeSessionRange("2026-02-01T19:00:00.000Z", null, "UTC")).toBe("Feb 1, 2026, 7:00 PM – still clocked in");
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
    ).toThrow(/after the start/);
    expect(
      parseBuildHoursAction({ action: "add_manual", orgId: ORG, clockIn: "2026-02-01T17:00:00Z", clockOut: "2026-02-01T19:00:00Z", timeZone: "Not/AZone" }),
    ).toMatchObject({ timeZone: undefined });
  });
  it("correct_record needs a reason and a real range", () => {
    expect(
      parseBuildHoursAction({
        action: "correct_record",
        orgId: ORG,
        id: U1,
        clockIn: "2026-02-01T17:00:00Z",
        clockOut: "2026-02-01T19:00:00Z",
        note: "Forgot to clock out",
        timeZone: "America/Chicago",
      }),
    ).toMatchObject({ action: "correct_record", id: U1, note: "Forgot to clock out", timeZone: "America/Chicago" });
    expect(() =>
      parseBuildHoursAction({ action: "correct_record", orgId: ORG, id: U1, clockIn: "2026-02-01T17:00:00Z", clockOut: "2026-02-01T19:00:00Z", note: " " }),
    ).toThrow(/why you are changing/);
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
