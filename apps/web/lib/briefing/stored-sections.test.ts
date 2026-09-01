import { describe, expect, it } from "vitest";
import {
  briefingWinProbability,
  hasStoredOpponentIntel,
  includeStoredBriefingSections,
} from "./stored-sections";
import type { BriefingCard, BriefingCounterBook, BriefingDefensePlan, BriefingWatchNote } from "./types";
import type { BriefingPrediction } from "../briefing";

function card(overrides: Partial<BriefingCard> = {}): BriefingCard {
  return {
    gamePlan: "Hold the midline",
    autoAssignment: null,
    defenseFocus: null,
    keyThreats: null,
    driverNotes: null,
    roleAssignments: [],
    updatedAt: "2026-03-14T12:00:00.000Z",
    ...overrides,
  };
}

function counterBook(overrides: Partial<BriefingCounterBook> = {}): BriefingCounterBook {
  return {
    id: "cb-1",
    teamKey: "frc254",
    teamNumber: 254,
    title: "Counter-book — Team 254",
    matchesScouted: 6,
    tendencies: [],
    failureTriggers: [],
    counterPlan: "Deny the far feeder.",
    summary: "",
    createdAt: "2026-03-14T12:00:00.000Z",
    ...overrides,
  };
}

function watchNote(overrides: Partial<BriefingWatchNote> = {}): BriefingWatchNote {
  return {
    teamKey: "frc254",
    teamNumber: 254,
    note: "Bump them off the feeder.",
    createdAt: "2026-03-14T12:00:00.000Z",
    ...overrides,
  };
}

function defensePlan(overrides: Partial<BriefingDefensePlan> = {}): BriefingDefensePlan {
  return {
    opponentTeamNumber: 254,
    opponentTeamName: "Cheesy Poofs",
    recommendation: "play_defense",
    assignedDefender: "us",
    confidence: 0.7,
    rationale: "Slow cycles.",
    computedAt: "2026-03-14T12:00:00.000Z",
    ...overrides,
  };
}

function prediction(overrides: Partial<BriefingPrediction> = {}): BriefingPrediction {
  return {
    pRed: 0.62,
    pBlue: 0.38,
    confidenceLow: 0.5,
    confidenceHigh: 0.74,
    modelVersion: "fusion-v3",
    keyFactors: [],
    caveats: [],
    scoredAt: "2026-03-14T15:00:00Z",
    ...overrides,
  };
}

describe("includeStoredBriefingSections", () => {
  it("marks every stored section empty when the org has no rows (TBA-only)", () => {
    const { included, empty } = includeStoredBriefingSections({
      card: null,
      counterBooks: [],
      watchNotes: [],
      defensePlans: [],
    });
    expect(included).toEqual([]);
    expect(empty).toEqual(["card", "counterBooks", "watchNotes", "defensePlans"]);
  });

  it("includes only the stored sections that have rows", () => {
    const { included, empty } = includeStoredBriefingSections({
      card: card(),
      counterBooks: [counterBook()],
      watchNotes: [],
      defensePlans: [defensePlan()],
    });
    expect(included).toEqual(["card", "counterBooks", "defensePlans"]);
    expect(empty).toEqual(["watchNotes"]);
  });

  it("includes a watchlist section when a note exists and leaves the rest empty", () => {
    const { included, empty } = includeStoredBriefingSections({
      card: null,
      counterBooks: [],
      watchNotes: [watchNote()],
      defensePlans: [],
    });
    expect(included).toEqual(["watchNotes"]);
    expect(empty).toEqual(["card", "counterBooks", "defensePlans"]);
  });
});

describe("hasStoredOpponentIntel", () => {
  it("is false for TBA-only (no stored counter-book, watchlist, or defense)", () => {
    expect(hasStoredOpponentIntel({ counterBooks: [], watchNotes: [], defensePlans: [] })).toBe(false);
  });

  it("is true when any stored opponent source has a row", () => {
    expect(hasStoredOpponentIntel({ counterBooks: [counterBook()], watchNotes: [], defensePlans: [] })).toBe(
      true,
    );
    expect(hasStoredOpponentIntel({ counterBooks: [], watchNotes: [watchNote()], defensePlans: [] })).toBe(true);
    expect(hasStoredOpponentIntel({ counterBooks: [], watchNotes: [], defensePlans: [defensePlan()] })).toBe(
      true,
    );
  });
});

describe("briefingWinProbability", () => {
  it("uses the stored prediction for our alliance", () => {
    expect(briefingWinProbability(prediction(), "red")).toBe(0.62);
    expect(briefingWinProbability(prediction(), "blue")).toBe(0.38);
  });

  it("returns null without a stored prediction — never a DEMO win % from TBA", () => {
    expect(briefingWinProbability(null, "red")).toBeNull();
    expect(briefingWinProbability(prediction(), null)).toBeNull();
  });

  it("refuses a DEMO model version even if numbers are present", () => {
    expect(briefingWinProbability(prediction({ modelVersion: "DEMO" }), "red")).toBeNull();
    expect(briefingWinProbability(prediction({ modelVersion: "demo-v1" }), "blue")).toBeNull();
  });
});
