import { describe, expect, it } from "vitest";
import type { PickCandidate } from "@vantage/prediction-strategy";
import {
  buildPickReasons,
  clockRemaining,
  clockUrgency,
  PICK_CLOCK_SECONDS,
  recommendNextPick,
} from "./pick-clock";

function candidate(partial: Partial<PickCandidate> & Pick<PickCandidate, "teamKey">): PickCandidate {
  return {
    teamNumber: null,
    nickname: null,
    epa: null,
    autoEpa: null,
    endgameEpa: null,
    source: null,
    record: null,
    rank: null,
    scoutSample: 0,
    reliability: null,
    foulRate: null,
    suggestedTier: null,
    ...partial,
  };
}

describe("pick-clock", () => {
  it("exposes the alliance-selection 45-second duration", () => {
    expect(PICK_CLOCK_SECONDS).toBe(45);
  });

  it("prefers the top remaining pick-list entry over raw EPA order", () => {
    const candidates = [
      candidate({
        teamKey: "frc100",
        teamNumber: 100,
        nickname: "High EPA",
        epa: 70,
        suggestedTier: "first",
        scoutSample: 4,
        reliability: 90,
      }),
      candidate({
        teamKey: "frc50",
        teamNumber: 50,
        nickname: "List pick",
        epa: 45,
        suggestedTier: "second",
        scoutSample: 3,
        reliability: 85,
        foulRate: 0.2,
      }),
    ];
    const result = recommendNextPick({
      candidates,
      pickListEntries: [
        { teamKey: "frc50", rank: 1, tier: "first", notes: "Defense + climb", listName: "Alliance" },
        { teamKey: "frc100", rank: 2, tier: "first", notes: null, listName: "Alliance" },
      ],
    });
    expect(result.recommendation?.teamKey).toBe("frc50");
    expect(result.recommendation?.headline).toMatch(/#1/);
    expect(result.recommendation?.reasons.some((r) => /Defense/.test(r.label))).toBe(true);
    expect(result.alternates[0]?.teamKey).toBe("frc100");
  });

  it("falls back to pick-desk ranking when no list remains", () => {
    const candidates = [
      candidate({
        teamKey: "frc9",
        teamNumber: 9,
        epa: 55,
        suggestedTier: "first",
        reliability: 88,
        foulRate: 0.1,
        scoutSample: 5,
        rank: 2,
        record: "9-1-0",
      }),
      candidate({
        teamKey: "frc2",
        teamNumber: 2,
        epa: 40,
        suggestedTier: "second",
        scoutSample: 2,
      }),
    ];
    const result = recommendNextPick({
      candidates,
      excludedTeamKeys: ["frc9"],
    });
    expect(result.recommendation?.teamKey).toBe("frc2");
    expect(result.availableCount).toBe(1);
    expect(result.excludedCount).toBe(1);
  });

  it("skips excluded teams and never invents EPA in reasons", () => {
    const noEpa = candidate({
      teamKey: "frc7",
      teamNumber: 7,
      nickname: "Unknown",
      scoutSample: 0,
      rank: 12,
    });
    const { headline, reasons } = buildPickReasons(noEpa, null);
    expect(headline).toBe("Event rank #12");
    expect(reasons.every((r) => !/\bEPA\b/.test(r.label))).toBe(true);
    expect(reasons.some((r) => /No scout sample/.test(r.label))).toBe(true);
  });

  it("flags low reliability and high foul risk as caution tones", () => {
    const shaky = candidate({
      teamKey: "frc3",
      teamNumber: 3,
      epa: 62,
      suggestedTier: "first",
      reliability: 50,
      foulRate: 2.1,
      scoutSample: 6,
    });
    const { reasons } = buildPickReasons(shaky, null);
    expect(reasons.some((r) => r.tone === "caution" && /Reliability/.test(r.label))).toBe(true);
    expect(reasons.some((r) => r.tone === "caution" && /Foul risk/.test(r.label))).toBe(true);
  });

  it("counts down the pick clock and maps urgency bands", () => {
    const started = 1_000_000;
    expect(clockRemaining(null, started + 5_000)).toBeNull();
    expect(clockRemaining(started, started)).toBe(45);
    expect(clockRemaining(started, started + 30_000)).toBe(15);
    expect(clockRemaining(started, started + 60_000)).toBe(0);
    expect(clockUrgency(null)).toBe("idle");
    expect(clockUrgency(30)).toBe("ok");
    expect(clockUrgency(15)).toBe("warn");
    expect(clockUrgency(5)).toBe("critical");
  });

  it("surfaces low-data TBA mode and EPA-drift callouts on the clock", () => {
    const rising = candidate({
      teamKey: "frc80",
      teamNumber: 80,
      epa: 60,
      suggestedTier: "first",
      scoutSample: 0,
      rank: 4,
    });
    const { headline, reasons } = buildPickReasons(rising, null, {
      pickMode: "low_data_tba",
      epaDrift: {
        teamKey: "frc80",
        seasonEpa: 60,
        recentAverage: 80,
        delta: 20,
        divergent: true,
        label: "EPA may lag — last-3 share ~80 (+20.0) above EPA 60",
      },
    });
    expect(headline).toMatch(/Quick pick/);
    expect(reasons.some((r) => /EPA lag/.test(r.label))).toBe(true);
    expect(reasons.some((r) => /Low scout coverage/.test(r.label))).toBe(true);

    const result = recommendNextPick({
      candidates: [rising],
      pickMode: "low_data_tba",
      epaDrifts: [
        {
          teamKey: "frc80",
          seasonEpa: 60,
          recentAverage: 80,
          delta: 20,
          divergent: true,
          label: "EPA may lag",
        },
      ],
    });
    expect(result.recommendation?.epaDrift?.divergent).toBe(true);
  });

});
