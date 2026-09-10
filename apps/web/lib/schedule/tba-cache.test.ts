import { describe, expect, it } from "vitest";
import {
  SCHEDULE_POLL_MS,
  allianceScore,
  allianceTeamKeys,
  buildScheduleView,
  classifyScheduleCache,
  mapTbaScheduleMatches,
  scheduleCacheRequiredCopy,
  shouldRefreshSchedule,
  type TbaMatchCacheRow,
} from "./tba-cache";
import { expectPlainCopy } from "../ui/copy-assertions";

const CONTEXT = {
  orgId: "org-1",
  orgName: "1678",
  teamNumber: 1678,
  role: "member",
  eventKey: "2026casj",
  eventName: "San Jose",
};

function row(overrides: Partial<TbaMatchCacheRow> = {}): TbaMatchCacheRow {
  return {
    matchKey: "2026casj_qm1",
    compLevel: "qm",
    matchNumber: 1,
    scheduledTime: "2026-03-14T17:00:00Z",
    redAlliance: { teamKeys: ["frc1678", "frc254", "frc973"] },
    blueAlliance: { teamKeys: ["frc118", "frc148", "frc2056"] },
    winningAlliance: null,
    scoutCount: 0,
    ...overrides,
  };
}

describe("schedule TBA cache refresh", () => {
  it("keeps an event-day cadence of at least 15s", () => {
    expect(SCHEDULE_POLL_MS).toBeGreaterThanOrEqual(15_000);
  });

  it("pauses while the tab is hidden", () => {
    expect(shouldRefreshSchedule({ visibilityState: "hidden" })).toBe(false);
    expect(shouldRefreshSchedule({ visibilityState: "visible" })).toBe(true);
    expect(shouldRefreshSchedule({ visibilityState: undefined })).toBe(true);
  });

  it("does not overlap an in-flight refresh", () => {
    expect(shouldRefreshSchedule({ visibilityState: "visible", inFlight: true })).toBe(false);
    expect(shouldRefreshSchedule({ visibilityState: "visible", inFlight: false })).toBe(true);
    expect(shouldRefreshSchedule({ visibilityState: "hidden", inFlight: true })).toBe(false);
    expect(shouldRefreshSchedule({ visibilityState: "hidden", pauseWhenHidden: false })).toBe(true);
  });
});

describe("classifyScheduleCache", () => {
  it("is setup until an event is selected", () => {
    expect(classifyScheduleCache({ eventKey: null, matchCount: 0 })).toBe("setup");
    expect(classifyScheduleCache({ eventKey: "", matchCount: 12 })).toBe("setup");
  });

  it("is cache_required when the event is set but Neon has no match rows", () => {
    expect(classifyScheduleCache({ eventKey: "2026casj", matchCount: 0 })).toBe("cache_required");
  });

  it("is ready only after cache rows exist", () => {
    expect(classifyScheduleCache({ eventKey: "2026casj", matchCount: 1 })).toBe("ready");
  });
});

describe("mapTbaScheduleMatches", () => {
  it("stays blank when the cache has no rows — never invents qual slots", () => {
    expect(mapTbaScheduleMatches([])).toEqual([]);
  });

  it("maps exactly the cached rows, without padding alliances or missing quals", () => {
    const matches = mapTbaScheduleMatches([
      row(),
      row({
        matchKey: "2026casj_qm2",
        matchNumber: 2,
        redAlliance: { team_keys: ["frc1678"] },
        blueAlliance: { teamKeys: ["frc118", "frc148"] },
      }),
    ]);
    expect(matches).toHaveLength(2);
    expect(matches.map((entry) => entry.matchKey)).toEqual(["2026casj_qm1", "2026casj_qm2"]);
    expect(matches[1]?.red).toEqual(["frc1678"]);
    expect(matches[1]?.blue).toEqual(["frc118", "frc148"]);
  });

  it("skips incomplete cache rows instead of inventing a slot", () => {
    expect(
      mapTbaScheduleMatches([
        row({ matchKey: null }),
        row({ matchKey: "2026casj_qm9", compLevel: null }),
        row({ matchKey: "2026casj_qm8", matchNumber: null }),
        row({ matchKey: "2026casj_qm3", matchNumber: 3 }),
      ]).map((entry) => entry.matchKey),
    ).toEqual(["2026casj_qm3"]);
  });

  it("leaves scores and winner blank until the cache has them", () => {
    const [unscored] = mapTbaScheduleMatches([row()]);
    expect(unscored?.redScore).toBeNull();
    expect(unscored?.blueScore).toBeNull();
    expect(unscored?.winningAlliance).toBeNull();

    const [scored] = mapTbaScheduleMatches([
      row({
        redAlliance: { teamKeys: ["frc1"], score: 87 },
        blueAlliance: { teamKeys: ["frc2"], score: 43 },
        winningAlliance: "red",
      }),
    ]);
    expect(scored?.redScore).toBe(87);
    expect(scored?.blueScore).toBe(43);
    expect(scored?.winningAlliance).toBe("red");
  });
});

describe("alliance helpers", () => {
  it("reads teamKeys or team_keys and never pads to three", () => {
    expect(allianceTeamKeys({ teamKeys: ["frc1", "frc2"] })).toEqual(["frc1", "frc2"]);
    expect(allianceTeamKeys({ team_keys: ["frc3"] })).toEqual(["frc3"]);
    expect(allianceTeamKeys(null)).toEqual([]);
    expect(allianceTeamKeys({ teamKeys: ["", "  "] })).toEqual([]);
  });

  it("treats missing or non-finite scores as blank", () => {
    expect(allianceScore(null)).toBeNull();
    expect(allianceScore({ score: "" })).toBeNull();
    expect(allianceScore({ score: "not-a-score" })).toBeNull();
    expect(allianceScore({ score: 12 })).toBe(12);
  });
});

describe("buildScheduleView", () => {
  it("is setup_required without an org or active event", () => {
    expect(
      buildScheduleView({
        context: { ...CONTEXT, orgId: null, eventKey: null },
      }).status,
    ).toBe("setup_required");
    expect(
      buildScheduleView({
        context: { ...CONTEXT, eventKey: null },
      }).status,
    ).toBe("setup_required");
  });

  it("returns a ready view with zero matches when the cache is cold", () => {
    const view = buildScheduleView({ context: CONTEXT, rows: [] });
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    expect(view.matches).toEqual([]);
    expect(classifyScheduleCache({ eventKey: view.context.eventKey, matchCount: view.matches.length })).toBe(
      "cache_required",
    );
  });

  it("never invents slots beyond the cache rows", () => {
    const view = buildScheduleView({ context: CONTEXT, rows: [row()] });
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    expect(view.matches).toHaveLength(1);
    expect(classifyScheduleCache({ eventKey: view.context.eventKey, matchCount: view.matches.length })).toBe(
      "ready",
    );
  });
});

describe("scheduleCacheRequiredCopy", () => {
  it("says the board stays blank until TBA cache rows — never invented slots", () => {
    const copy = scheduleCacheRequiredCopy();
    expect(copy.description).toMatch(/cache/i);
    expectPlainCopy(copy.description);
    expect(`${copy.title} ${copy.description}`).not.toMatch(/\bDEMO\b/);
  });
});
