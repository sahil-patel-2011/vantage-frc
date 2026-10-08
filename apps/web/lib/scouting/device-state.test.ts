import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearScoutDraft, readActiveScoutDraft, readScoutClock, readScoutDraft, rememberActiveScoutDraft, scoutDraftStorageKey, writeScoutClock, writeScoutDraft } from "./draft-autosave";
import { readRobotViewState, robotViewStorageKey, writeRobotViewState } from "./robot-view-state";

describe("personal scouting device recovery", () => {
  beforeEach(() => {
    const rows = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => rows.get(k) ?? null, setItem: (k: string, v: string) => rows.set(k, v), removeItem: (k: string) => rows.delete(k) } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("does not report a discarded draft when device storage refused deletion", () => {
    writeScoutDraft("kept", { payload: { score: 1 }, confidence: "normal", matchKey: "event_qm1", teamKey: "frc254" });
    const remove = vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    expect(clearScoutDraft("kept")).toBe(false);
    expect(readScoutDraft("kept")?.payload).toEqual({ score: 1 });
    remove.mockRestore();
    expect(clearScoutDraft("kept")).toBe(true);
    expect(readScoutDraft("kept")).toBeNull();
  });

  it("recovers correction identity and the exact published questions offline", () => {
    const orgId = "22222222-2222-4222-8222-222222222222";
    const schema = { id: "original-form", orgId, year: 2026, type: "pit" as const, version: 1, definition: { title: "Pit", fields: [{ key: "drive", label: "Drivetrain", type: "text" as const }] } };
    const draft = { clientId: "original-report", schemaId: schema.id, schema, source: "manual" as const, confidence: "low" as const, payload: { drive: "swerve" }, matchKey: "", teamKey: "frc6925" };
    writeScoutDraft("pit-draft", draft);
    expect(readScoutDraft("pit-draft")).toMatchObject(draft);
  });

  it("keeps legacy answers readable and preserves answers when a form snapshot is corrupt", () => {
    const legacy = { payload: { score: 0 }, confidence: "normal" as const, matchKey: "event_qm1", teamKey: "frc254" };
    writeScoutDraft("legacy", legacy);
    expect(readScoutDraft("legacy")).toMatchObject(legacy);
    window.localStorage.setItem("broken-form", JSON.stringify({ ...legacy, savedAt: new Date().toISOString(), schemaId: "old-form", schema: { id: "old-form", definition: { fields: [null] } } }));
    expect(readScoutDraft("broken-form")).toMatchObject({ ...legacy, schemaId: "old-form" });
    expect(readScoutDraft("broken-form")?.schema).toBeUndefined();
  });

  it.each([{ payload: [] }, { confidence: "invented" }, { teamKey: null }, { matchKey: 1 }, { savedAt: "invalid" }, { clientId: 9 }])("does not restore malformed draft state: %j", change => {
    window.localStorage.setItem("invalid", JSON.stringify({ payload: { score: 0 }, confidence: "normal", matchKey: "event_qm1", teamKey: "frc254", savedAt: new Date().toISOString(), ...change }));
    expect(readScoutDraft("invalid")).toBeNull();
  });

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
