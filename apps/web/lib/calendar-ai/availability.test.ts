import { describe, expect, it } from "vitest";
import {
  conflictsWith,
  MIN_SAMPLES_FOR_PATTERN,
  proposeSlots,
  slotEvidence,
  type PastEvent,
} from "./availability";

/** A Tuesday 18:00 session. 2026-09-08 is a Tuesday. */
function tuesday(week: number, going: number, invited = 12): PastEvent {
  const day = 8 + week * 7;
  return {
    startsAt: `2026-09-${String(day).padStart(2, "0")}T18:00:00`,
    endsAt: `2026-09-${String(day).padStart(2, "0")}T20:00:00`,
    kind: "build",
    subteamId: null,
    going,
    invited,
  };
}

describe("slotEvidence", () => {
  it("gives no evidence sentence for a slot seen only twice", () => {
    // Two Tuesdays is an anecdote. Presenting it as a reason to schedule is
    // exactly the fabrication this file exists to prevent.
    const slots = slotEvidence({ events: [tuesday(0, 9), tuesday(1, 10)] });
    expect(slots).toHaveLength(1);
    expect(slots[0]!.samples).toBe(2);
    expect(slots[0]!.evidence).toBeNull();
  });

  it("gives an evidence sentence once there are enough sessions", () => {
    const slots = slotEvidence({ events: [tuesday(0, 9), tuesday(1, 10), tuesday(2, 8)] });
    expect(slots[0]!.samples).toBe(MIN_SAMPLES_FOR_PATTERN);
    expect(slots[0]!.evidence).toContain("Tuesday");
    expect(slots[0]!.evidence).toContain("3 past sessions");
    expect(slots[0]!.evidence).toContain("%");
  });

  it("reports turnout from real numbers, not a guess", () => {
    const slots = slotEvidence({ events: [tuesday(0, 6), tuesday(1, 9), tuesday(2, 9)] });
    expect(slots[0]!.meanTurnout).toBe(8); // (6+9+9)/3
    expect(slots[0]!.meanShare).toBe(0.67); // mean of 6/12, 9/12, 9/12
  });

  it("omits the share when nobody was recorded as invited", () => {
    const slots = slotEvidence({
      events: [tuesday(0, 5, 0), tuesday(1, 5, 0), tuesday(2, 5, 0)],
    });
    expect(slots[0]!.meanShare).toBeNull();
    expect(slots[0]!.evidence).not.toContain("%");
  });

  it("filters to one subteam when asked", () => {
    const mech = { ...tuesday(0, 4), subteamId: "mech" };
    const prog = { ...tuesday(1, 9), subteamId: "prog" };
    const slots = slotEvidence({ events: [mech, prog], subteamId: "mech" });
    expect(slots).toHaveLength(1);
    expect(slots[0]!.meanTurnout).toBe(4);
  });

  it("returns nothing at all when the team has no history", () => {
    expect(slotEvidence({ events: [] })).toEqual([]);
  });
});

describe("conflictsWith", () => {
  const busy = [{ startsAt: "2026-09-15T18:00:00", endsAt: "2026-09-15T20:00:00", title: "Build night" }];

  it("detects an overlap", () => {
    const hit = conflictsWith(new Date("2026-09-15T19:00:00"), new Date("2026-09-15T21:00:00"), busy);
    expect(hit?.title).toBe("Build night");
  });

  it("lets a slot start exactly when another ends", () => {
    expect(conflictsWith(new Date("2026-09-15T20:00:00"), new Date("2026-09-15T22:00:00"), busy)).toBeNull();
  });

  it("treats an open-ended event as an hour rather than as zero length", () => {
    // Zero length would let us schedule straight over an event whose end was
    // never filled in, which is most of them.
    const open = [{ startsAt: "2026-09-15T18:00:00", endsAt: null, title: "Standup" }];
    expect(conflictsWith(new Date("2026-09-15T18:30:00"), new Date("2026-09-15T19:30:00"), open)).not.toBeNull();
    expect(conflictsWith(new Date("2026-09-15T19:30:00"), new Date("2026-09-15T20:30:00"), open)).toBeNull();
  });
});

describe("proposeSlots", () => {
  const now = new Date("2026-09-09T09:00:00"); // Wednesday
  const evidence = slotEvidence({ events: [tuesday(0, 9), tuesday(1, 10), tuesday(2, 8)] });

  it("proposes real future dates carrying the evidence", () => {
    const out = proposeSlots({ now, evidence, busy: [], durationMinutes: 120, horizonDays: 21, limit: 2 });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.weekdayName).toBe("Tuesday");
    expect(new Date(out[0]!.startsAt).getTime()).toBeGreaterThan(now.getTime());
    expect(out[0]!.reason).toContain("past sessions");
    expect(out[0]!.clear).toBe(true);
  });

  it("marks a proposal that clashes and names what it clashes with", () => {
    const busy = [{ startsAt: "2026-09-15T18:00:00", endsAt: "2026-09-15T20:00:00", title: "Districts" }];
    const out = proposeSlots({ now, evidence, busy, durationMinutes: 120, horizonDays: 21, limit: 5 });
    const clashing = out.find((p) => !p.clear);
    if (clashing) expect(clashing.conflictTitle).toBe("Districts");
    // Whatever else happens, a clear slot must outrank a clashing one.
    expect(out[0]!.clear).toBe(true);
  });

  it("proposes nothing when there is no history and no stated preference", () => {
    // The API turns this into "no attendance history yet" rather than three
    // invented times that look authoritative.
    const out = proposeSlots({ now, evidence: [], busy: [], durationMinutes: 60, horizonDays: 14 });
    expect(out).toEqual([]);
  });

  it("uses an explicit preference when there is no history, and claims no reason for it", () => {
    const out = proposeSlots({
      now,
      evidence: [],
      busy: [],
      durationMinutes: 60,
      horizonDays: 14,
      preferred: { weekday: 4, hour: 17 },
      limit: 1,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.weekdayName).toBe("Thursday");
    expect(out[0]!.reason).toBeNull();
  });

  it("never proposes a time in the past", () => {
    const out = proposeSlots({ now, evidence, busy: [], durationMinutes: 60, horizonDays: 30, limit: 10 });
    for (const p of out) expect(new Date(p.startsAt).getTime()).toBeGreaterThan(now.getTime());
  });
});
