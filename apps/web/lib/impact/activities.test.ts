import { describe, expect, it } from "vitest";
import { impactAudienceLabel, impactCategoryLabel, summarizeImpact } from "./activities";
import type { ImpactActivity } from "./types";

let seq = 0;
function activity(overrides: Partial<ImpactActivity> = {}): ImpactActivity {
  seq += 1;
  return {
    id: `act-${seq}`,
    title: `Event ${seq}`,
    category: "community_event",
    occurredOn: "2026-02-15",
    durationMinutes: 120,
    participantCount: 5,
    peopleReached: 40,
    audience: "k12",
    location: null,
    seasonYear: 2026,
    description: null,
    evidenceAwards: [],
    ...overrides,
  };
}

describe("summarizeImpact", () => {
  it("returns an all-zero summary for no activities", () => {
    const s = summarizeImpact([]);
    expect(s.totalEvents).toBe(0);
    expect(s.totalHours).toBe(0);
    expect(s.totalPeopleReached).toBe(0);
    expect(s.impactSignal).toBe(0);
    expect(s.byCategory).toEqual([]);
    expect(s.byMonth).toEqual([]);
  });

  it("totals minutes into hours and sums people reached / participants", () => {
    const s = summarizeImpact([
      activity({ durationMinutes: 90, peopleReached: 100, participantCount: 6 }),
      activity({ durationMinutes: 30, peopleReached: 50, participantCount: 4 }),
    ]);
    expect(s.totalEvents).toBe(2);
    expect(s.totalMinutes).toBe(120);
    expect(s.totalHours).toBe(2);
    expect(s.totalPeopleReached).toBe(150);
    expect(s.totalParticipants).toBe(10);
  });

  it("groups by category, audience, and month with sensible ordering", () => {
    const s = summarizeImpact([
      activity({ category: "stem_demo", audience: "k12", occurredOn: "2026-01-10", peopleReached: 200 }),
      activity({ category: "stem_demo", audience: "public", occurredOn: "2026-02-10", peopleReached: 60 }),
      activity({ category: "mentoring", audience: "other_teams", occurredOn: "2026-02-20", peopleReached: 15 }),
    ]);
    const stem = s.byCategory.find((c) => c.category === "stem_demo");
    expect(stem?.events).toBe(2);
    expect(s.byCategory[0]?.category).toBe("stem_demo"); // most hours first
    expect(s.byAudience[0]?.audience).toBe("k12"); // most people reached first
    expect(s.byMonth.map((m) => m.month)).toEqual(["2026-01", "2026-02"]); // chronological
    expect(s.byMonth.find((m) => m.month === "2026-02")?.events).toBe(2);
  });

  it("ignores malformed dates in the month rollup without dropping totals", () => {
    const s = summarizeImpact([
      activity({ occurredOn: "not-a-date", peopleReached: 30 }),
      activity({ occurredOn: "2026-03-01", peopleReached: 20 }),
    ]);
    expect(s.totalEvents).toBe(2);
    expect(s.totalPeopleReached).toBe(50);
    expect(s.byMonth.map((m) => m.month)).toEqual(["2026-03"]);
  });

  it("orders recent activities newest-first and caps at 8", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      activity({ occurredOn: `2026-02-${String(i + 1).padStart(2, "0")}` }),
    );
    const s = summarizeImpact(many);
    expect(s.recent).toHaveLength(8);
    expect(s.recent[0]?.occurredOn).toBe("2026-02-12");
    expect(s.recent[7]?.occurredOn).toBe("2026-02-05");
  });

  it("produces a higher impact signal for sustained, high-volume outreach", () => {
    const oneBigEvent = summarizeImpact([
      activity({ durationMinutes: 300, peopleReached: 400, occurredOn: "2026-02-01" }),
    ]);
    const sustained = summarizeImpact(
      Array.from({ length: 6 }, (_, i) =>
        activity({ durationMinutes: 600, peopleReached: 200, occurredOn: `2026-0${i + 1}-15` }),
      ),
    );
    expect(sustained.impactSignal).toBeGreaterThan(oneBigEvent.impactSignal);
    expect(sustained.impactSignal).toBeLessThanOrEqual(1);
    expect(oneBigEvent.impactSignal).toBeGreaterThan(0);
  });

  it("respects custom targets", () => {
    const acts = [activity({ durationMinutes: 60, peopleReached: 10, occurredOn: "2026-02-01" })];
    const easy = summarizeImpact(acts, { hoursTarget: 1, peopleTarget: 10, sustainedMonths: 1 });
    const hard = summarizeImpact(acts, { hoursTarget: 1000, peopleTarget: 10000, sustainedMonths: 12 });
    expect(easy.impactSignal).toBeGreaterThan(hard.impactSignal);
  });
});

describe("labels", () => {
  it("labels categories and audiences", () => {
    expect(impactCategoryLabel("stem_demo")).toBe("STEM demo / workshop");
    expect(impactAudienceLabel("other_teams")).toBe("Other FRC teams");
  });
});
