import { describe, expect, it } from "vitest";
import {
  MATCH_PAD_SCOUT_KEYS,
  actionsForPhase,
  eventsFromPayload,
  pathFromPayload,
  pathFromTaps,
  payloadFromPad,
  qualsFromInputs,
  scoresWhileMoving,
  serializePad,
  type MatchPadEvent,
} from "./match-pad";

function event(
  type: MatchPadEvent["type"],
  phase: MatchPadEvent["phase"],
  at: string,
  id = `${type}-${at}`,
): MatchPadEvent {
  return { id, type, phase, at };
}

describe("match pad", () => {
  it("treats an empty pad as no moving scores and no 0-filled scout metrics", () => {
    expect(scoresWhileMoving([])).toBe(false);
    const payload = payloadFromPad([]);
    expect(payload).toEqual({});
    for (const key of MATCH_PAD_SCOUT_KEYS) {
      expect(payload[key], key).toBeUndefined();
    }
  });

  it("marks Scored while moving when a feed exists even without a score", () => {
    const events = [event("feed", "auto", "2026-09-15T12:00:00.000Z")];
    expect(scoresWhileMoving(events)).toBe(true);
    const payload = payloadFromPad(events);
    expect(payload.totalFuelFed).toBe(1);
    expect(payload.scoresWhileMoving).toBe(1);
    expect(payload.estimatedTotalFuelScored).toBeUndefined();
    expect(payload.scoringRate).toBeUndefined();
    expect(payload.reliability).toBeUndefined();
  });

  it("hides climb in auto and keeps climb for endgame", () => {
    expect(actionsForPhase("auto")).toEqual(["score", "feed"]);
    expect(actionsForPhase("auto")).not.toContain("climb");
    expect(actionsForPhase("teleop")).toEqual(["score", "feed", "defend"]);
    expect(actionsForPhase("endgame")).toEqual(["climb", "defend"]);
  });

  it("emits rates only when duration is greater than zero and counts exist", () => {
    const loneScore = [event("score", "teleop", "2026-09-15T12:00:00.000Z")];
    expect(payloadFromPad(loneScore).estimatedTotalFuelScored).toBe(1);
    expect(payloadFromPad(loneScore).scoringRate).toBeUndefined();
    expect(payloadFromPad(loneScore, { durationSec: 0 }).scoringRate).toBeUndefined();

    const twoScores = [
      event("score", "teleop", "2026-09-15T12:00:00.000Z"),
      event("score", "teleop", "2026-09-15T12:01:00.000Z"),
    ];
    expect(payloadFromPad(twoScores).scoringRate).toBe(2);
    expect(payloadFromPad(twoScores, { durationSec: 120 }).scoringRate).toBe(1);
  });

  it("does not invent a moving-score flag from defend or climb alone", () => {
    expect(scoresWhileMoving([event("defend", "teleop", "2026-09-15T12:00:00.000Z")])).toBe(false);
    expect(scoresWhileMoving([event("climb", "endgame", "2026-09-15T12:00:00.000Z")])).toBe(false);
  });

  it("omits the scoresWhileMoving key when no score or feed was tapped", () => {
    expect(payloadFromPad([])).not.toHaveProperty("scoresWhileMoving");
    expect(
      payloadFromPad([event("defend", "teleop", "2026-09-15T12:00:00.000Z")]),
    ).not.toHaveProperty("scoresWhileMoving");
    expect(
      payloadFromPad([event("climb", "endgame", "2026-09-15T12:00:00.000Z")]),
    ).not.toHaveProperty("scoresWhileMoving");
  });

  it("round-trips pad events through the form payload", () => {
    const events: MatchPadEvent[] = [
      event("score", "auto", "2026-09-15T12:00:00.000Z", "score-1"),
      { id: "note-1", type: "note", phase: "teleop", at: "2026-09-15T12:00:08.000Z", note: "tipped" },
    ];
    const stored = serializePad(events);
    expect(stored).toEqual(events);
    expect(eventsFromPayload({ matchPadEvents: stored })).toEqual(events);
  });

  it("rejects a junk pad payload as an empty event list", () => {
    expect(eventsFromPayload(undefined)).toEqual([]);
    expect(eventsFromPayload({})).toEqual([]);
    expect(eventsFromPayload({ matchPadEvents: "nope" })).toEqual([]);
    expect(eventsFromPayload({ matchPadEvents: [{ id: 1, type: "score" }] })).toEqual([]);
    expect(
      eventsFromPayload({
        matchPadEvents: [{ id: "bad", type: "explode", phase: "auto", at: "2026-09-15T12:00:00.000Z" }],
      }),
    ).toEqual([]);
  });

  it("omits blank post-match quals and keeps only 1–5 ratings", () => {
    expect(qualsFromInputs({})).toEqual({});
    expect(qualsFromInputs({ driverAbility: "", defenseEffectiveness: undefined })).toEqual({});
    expect(qualsFromInputs({ driverAbility: 0, defenseEffectiveness: 6 })).toEqual({});
    expect(qualsFromInputs({ driverAbility: 3 })).toEqual({ driverAbility: 3 });
    expect(qualsFromInputs({ driverAbility: "1", defenseEffectiveness: 5 })).toEqual({
      driverAbility: 1,
      defenseEffectiveness: 5,
    });
  });

  it("omits autoPath until two finite taps exist", () => {
    const one = [{ t: 0, x: 4, y: 8 }];
    expect(pathFromTaps(one)).toBeNull();
    expect(payloadFromPad([], { path: one })).not.toHaveProperty("autoPath");

    const two = [
      { t: 0, x: 4, y: 8 },
      { t: 2, x: 20, y: 8 },
    ];
    expect(pathFromTaps(two)).toHaveLength(2);
    expect(payloadFromPad([], { path: two }).autoPath).toHaveLength(2);
    expect(payloadFromPad([event("score", "auto", "2026-09-15T12:00:00.000Z")], { path: two }).autoPath).toHaveLength(
      2,
    );
  });

  it("rejects a junk autoPath payload as no path", () => {
    expect(pathFromPayload(undefined)).toBeNull();
    expect(pathFromPayload({})).toBeNull();
    expect(pathFromPayload({ autoPath: "nope" })).toBeNull();
    expect(pathFromPayload({ autoPath: [{ x: 1 }] })).toBeNull();
    expect(pathFromPayload({ autoPath: [{ t: 0, x: 1, y: Number.NaN }, { t: 1, x: 2, y: 3 }] })).toBeNull();
    expect(
      pathFromPayload({
        autoPath: [
          [4, 8],
          [20, 8],
        ],
      }),
    ).toEqual([
      { t: 0, x: 4, y: 8 },
      { t: 1, x: 20, y: 8 },
    ]);
  });
});
