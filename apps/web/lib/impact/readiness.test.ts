import { describe, expect, it } from "vitest";
import { summarizeImpact } from "./activities";
import { computeImpactReadiness } from "./readiness";
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
    audience: "public",
    location: null,
    seasonYear: 2026,
    description: null,
    evidenceAwards: [],
    ...overrides,
  };
}

describe("computeImpactReadiness", () => {
  it("is fully zero with an empty log and prompts a first entry", () => {
    const r = computeImpactReadiness(summarizeImpact([]));
    expect(r.score).toBe(0);
    expect(r.tier).toBe("emerging");
    expect(r.components).toEqual({ volume: 0, reach: 0, cadence: 0, audienceBreadth: 0, youthFocus: 0 });
    expect(r.recommendations[0]).toMatch(/first community-impact/i);
  });

  it("rewards a sustained, broad, youth-focused record with a strong tier", () => {
    const activities: ImpactActivity[] = [];
    const audiences = ["k12", "public", "other_teams", "college"] as const;
    for (let m = 1; m <= 6; m += 1) {
      audiences.forEach((audience, i) =>
        activities.push(
          activity({
            audience,
            category: i % 2 === 0 ? "stem_demo" : "mentoring",
            durationMinutes: 240,
            peopleReached: 120,
            occurredOn: `2026-0${m}-1${i}`,
          }),
        ),
      );
    }
    const r = computeImpactReadiness(summarizeImpact(activities));
    expect(r.score).toBeGreaterThanOrEqual(0.66);
    expect(r.tier).toBe("strong");
    expect(r.monthsActive).toBe(6);
    expect(r.audiencesReached).toBeGreaterThanOrEqual(4);
  });

  it("flags weak cadence when everything happens in one month", () => {
    const activities = Array.from({ length: 5 }, (_, i) =>
      activity({ occurredOn: `2026-02-0${i + 1}`, peopleReached: 300, durationMinutes: 600 }),
    );
    const r = computeImpactReadiness(summarizeImpact(activities));
    expect(r.components.cadence).toBeLessThan(0.5);
    expect(r.recommendations.some((line) => /season|sustained|months/i.test(line))).toBe(true);
  });

  it("does not count internal-only events toward audience breadth", () => {
    const internal = computeImpactReadiness(
      summarizeImpact([activity({ audience: "internal" }), activity({ audience: "internal" })]),
    );
    expect(internal.audiencesReached).toBe(0);
    expect(internal.components.audienceBreadth).toBe(0);
  });

  it("recommends K-12 outreach when youth focus is absent", () => {
    const r = computeImpactReadiness(summarizeImpact([activity({ audience: "industry" })]));
    expect(r.components.youthFocus).toBe(0);
    expect(r.recommendations.some((line) => /k-12/i.test(line))).toBe(true);
  });

  it("keeps the score within 0..1 and monotonic with custom targets", () => {
    const acts = [activity({ durationMinutes: 120, peopleReached: 100, occurredOn: "2026-02-01" })];
    const easy = computeImpactReadiness(summarizeImpact(acts), { hoursTarget: 1, peopleTarget: 10, sustainedMonths: 1, audienceTarget: 1 });
    const hard = computeImpactReadiness(summarizeImpact(acts), { hoursTarget: 500, peopleTarget: 9000, sustainedMonths: 10, audienceTarget: 6 });
    expect(easy.score).toBeGreaterThan(hard.score);
    expect(hard.score).toBeGreaterThanOrEqual(0);
    expect(easy.score).toBeLessThanOrEqual(1);
  });
});
