import { describe, expect, it } from "vitest";
import { computeTeamHealthReadiness, hoursBetween, personKey, summarizeTeamHealth, weekStartUtc } from ".";

describe("team-health helpers", () => {
  it("keys people by user id when present, otherwise by name", () => {
    expect(personKey("u1", "Ada")).toBe("user:u1");
    expect(personKey(null, " Ada Lovelace ")).toBe("name:ada lovelace");
  });

  it("computes closed-session hours and Monday week starts from real timestamps", () => {
    expect(hoursBetween("2026-01-12T18:00:00.000Z", "2026-01-12T21:30:00.000Z")).toBe(3.5);
    expect(hoursBetween("2026-01-12T18:00:00.000Z", "2026-01-12T17:00:00.000Z")).toBe(0);
    expect(weekStartUtc("2026-01-14")).toBe("2026-01-12");
  });
});

describe("summarizeTeamHealth", () => {
  it("stays empty with null engagement when there are no logs", () => {
    const summary = summarizeTeamHealth({
      roster: [{ userId: "u1", name: "Ada" }],
      events: [],
      entries: [],
      sessions: [],
    });
    expect(summary.hasLogs).toBe(false);
    expect(summary.engagementScore).toBeNull();
    expect(summary.attendanceRate).toBeNull();
    expect(summary.hoursParticipation).toBeNull();
    expect(summary.checkIns).toHaveLength(0);
    expect(summary.trend).toHaveLength(0);
    expect(summary).not.toHaveProperty("avgMoraleRating");
    expect(JSON.stringify(summary)).not.toMatch(/moraleRating|avgMorale|morale_score/i);
  });

  it("ignores open hour sessions and events without entries", () => {
    const summary = summarizeTeamHealth({
      roster: [{ userId: "u1", name: "Ada" }],
      events: [{ id: "e1", title: "Build", kind: "build", occurredOn: "2026-01-12", creditHours: 2 }],
      entries: [],
      sessions: [
        {
          id: "h1",
          userId: "u1",
          name: "Ada",
          kind: "build",
          clockIn: "2026-01-12T18:00:00.000Z",
          clockOut: null,
        },
      ],
    });
    expect(summary.hasLogs).toBe(false);
    expect(summary.hourSessionCount).toBe(0);
    expect(summary.engagementScore).toBeNull();
  });

  it("builds engagement from attendance and closed hours only — never morale", () => {
    const summary = summarizeTeamHealth({
      roster: [
        { userId: "u1", name: "Ada" },
        { userId: "u2", name: "Bo" },
      ],
      events: [{ id: "e1", title: "Build", kind: "build", occurredOn: "2026-01-13", creditHours: 2 }],
      entries: [
        { eventId: "e1", userId: "u1", personName: "Ada", hours: 2 },
        { eventId: "e1", userId: "u1", personName: "Ada", hours: null },
      ],
      sessions: [
        {
          id: "h1",
          userId: "u1",
          name: "Ada",
          kind: "build",
          clockIn: "2026-01-13T18:00:00.000Z",
          clockOut: "2026-01-13T21:00:00.000Z",
        },
      ],
    });

    expect(summary.hasLogs).toBe(true);
    expect(summary.entryCount).toBe(2);
    expect(summary.uniqueAttendees).toBe(1);
    expect(summary.uniqueHourLoggers).toBe(1);
    expect(summary.totalShopHours).toBe(3);
    expect(summary.attendanceRate).toBe(0.5);
    expect(summary.hoursParticipation).toBe(0.5);
    expect(summary.engagementScore).toBe(0.5);
    expect(summary.checkIns.map((m) => m.name)).toEqual(["Bo"]);
    expect(summary.trend).toHaveLength(1);
    expect(summary.trend[0]?.weekStart).toBe("2026-01-12");
    expect(summary).not.toHaveProperty("avgMoraleRating");
    expect(JSON.stringify(summary)).not.toMatch(/moraleRating|avgMorale|morale_score/i);
  });
});

describe("computeTeamHealthReadiness", () => {
  it("returns no score or tier until logs exist", () => {
    const readiness = computeTeamHealthReadiness(
      summarizeTeamHealth({ roster: [], events: [], entries: [], sessions: [] }),
    );
    expect(readiness.score).toBeNull();
    expect(readiness.tier).toBeNull();
    expect(readiness.recommendations[0]).toMatch(/attendance or clock/i);
    expect(readiness).not.toHaveProperty("morale");
    expect(JSON.stringify(readiness)).not.toMatch(/moraleRating|avgMorale|morale_score/i);
  });

  it("flags roster members with no logs once engagement has a source", () => {
    const readiness = computeTeamHealthReadiness(
      summarizeTeamHealth({
        roster: [
          { userId: "u1", name: "Ada" },
          { userId: "u2", name: "Bo" },
        ],
        events: [],
        entries: [],
        sessions: [
          {
            id: "h1",
            userId: "u1",
            name: "Ada",
            kind: "build",
            clockIn: "2026-01-10T18:00:00.000Z",
            clockOut: "2026-01-10T20:00:00.000Z",
          },
        ],
      }),
    );
    expect(readiness.score).toBe(0.5);
    expect(readiness.tier).toBe("steady");
    expect(readiness.components.attendance).toBeNull();
    expect(readiness.components.hours).toBe(0.5);
    expect(readiness.recommendations.some((rec) => /no attendance or hours/i.test(rec))).toBe(true);
    expect(readiness.recommendations.some((rec) => /moraleRating|morale score/i.test(rec))).toBe(false);
  });
});
