import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearScoutDraft, readActiveScoutDraft, readScoutClock, rememberActiveScoutDraft, scoutDraftStorageKey, writeScoutClock, writeScoutDraft } from "./draft-autosave";
import { readRobotViewState, robotViewStorageKey, writeRobotViewState } from "./robot-view-state";

describe("personal scouting device recovery", () => {
  beforeEach(() => {
    const rows = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => rows.get(k) ?? null, setItem: (k: string, v: string) => rows.set(k, v), removeItem: (k: string) => rows.delete(k) } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("restores the exact active robot and running clock, without crossing accounts", () => {
    const context = { userId: "a", orgId: "team", eventKey: "event" };
    const target = { entryType: "match" as const, matchKey: "event_qm33", teamKey: "frc1678" };
    const key = scoutDraftStorageKey({ ...context, ...target })!;
    writeScoutDraft(key, { payload: { score: 0 }, confidence: "normal", matchKey: target.matchKey, teamKey: target.teamKey });
    writeScoutClock(key, 1000);
    rememberActiveScoutDraft(context, { key, type: "match", matchKey: target.matchKey, teamKey: target.teamKey });
    expect(readActiveScoutDraft(context)?.teamKey).toBe("frc1678");
    expect(readScoutClock(key, 5000)).toBe(1000);
    expect(readScoutClock(key, 500)).toBeNull();
    expect(readActiveScoutDraft({ ...context, userId: "b" })).toBeNull();
    clearScoutDraft(key);
    expect(readScoutClock(key)).toBeNull();
    expect(readActiveScoutDraft(context)).toBeNull();
  });

  it("recovers a clock even before any scoring answer, and respects an explicit reset", () => {
    const context = { userId: "a", orgId: "team", eventKey: "event" };
    const target = { entryType: "match" as const, matchKey: "event_qm2", teamKey: "frc2" };
    const key = scoutDraftStorageKey({ ...context, ...target })!;
    writeScoutClock(key, 1000);
    rememberActiveScoutDraft(context, { key, type: "match", matchKey: target.matchKey, teamKey: target.teamKey });
    expect(readActiveScoutDraft(context)?.matchKey).toBe("event_qm2");
    writeScoutClock(key, null);
    expect(readActiveScoutDraft(context)).toBeNull();
  });

  it("preserves three-team comparison, filters and detail across remounts with personal/event scopes", () => {
    const key = robotViewStorageKey("a", "team", "event");
    const state = { sort: "average" as const, selected: "frc1678", query: "1678", compare: ["frc1678", "frc6925", "frc254"], splitView: false };
    writeRobotViewState(key, state);
    expect(readRobotViewState(key)).toEqual(state);
    expect(readRobotViewState(robotViewStorageKey("b", "team", "event"))).toBeNull();
    expect(readRobotViewState(robotViewStorageKey("a", "team", "other-event"))).toBeNull();
    writeRobotViewState(key, { ...state, compare: ["frc1", "frc1"] });
    expect(readRobotViewState(key)).toBeNull();
  });
});
