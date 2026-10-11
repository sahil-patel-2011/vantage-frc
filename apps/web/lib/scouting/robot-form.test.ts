import { describe, expect, it } from "vitest";
import type { ScoutSchema } from "@vantage/scouting";
import type { ScoutDraftSnapshot } from "./draft-autosave";
import { EARLIER_FORM_NOTE, FORM_PINNED_NOTE, carryAnswersToForm, chooseRobotForm } from "./robot-form";

function form(id: string, version: number, fields: ScoutSchema["definition"]["fields"]): ScoutSchema {
  return { id, orgId: "org", year: 2026, type: "match", version, definition: { title: "Match", fields } };
}

const v1 = form("schema-v1", 1, [
  { key: "auto_points", label: "Auto points", type: "counter" },
  { key: "fouls", label: "Fouls", type: "counter" },
  { key: "climb", label: "Climb", type: "select", options: ["none", "low", "high"] },
]);
// v2 drops Fouls, narrows Climb's options and adds a defence question.
const v2 = form("schema-v2", 2, [
  { key: "auto_points", label: "Auto points", type: "counter" },
  { key: "climb", label: "Climb", type: "select", options: ["none", "high"] },
  { key: "defence", label: "Played defence", type: "boolean" },
]);

function draft(partial: Partial<ScoutDraftSnapshot> = {}): ScoutDraftSnapshot {
  return {
    payload: { auto_points: 4, fouls: 1, climb: "low" },
    confidence: "normal",
    matchKey: "2026gacmp_qm36",
    teamKey: "frc1678",
    savedAt: "2026-10-11T20:00:00Z",
    clientId: "draft-client",
    schemaId: v1.id,
    schema: v1,
    ...partial,
  };
}

describe("chooseRobotForm", () => {
  it("finishes a half-scouted robot on the form it was started on after a new version is published", () => {
    const choice = chooseRobotForm({ live: v2, draft: draft(), earlier: null });
    expect(choice).toMatchObject({ kind: "ready", from: "draft", note: FORM_PINNED_NOTE, clientId: "draft-client" });
    if (choice.kind !== "ready") throw new Error("expected ready");
    // The four Auto points are still there (they came back "not counted" before).
    expect(choice.schema.id).toBe(v1.id);
    expect(choice.payload).toEqual({ auto_points: 4, fouls: 1, climb: "low" });
  });

  it("uses the live form with no note when nothing changed", () => {
    const choice = chooseRobotForm({ live: v2, draft: draft({ schemaId: v2.id, schema: v2 }), earlier: null });
    expect(choice).toMatchObject({ kind: "ready", note: null });
    expect(chooseRobotForm({ live: v2, draft: null, earlier: null })).toMatchObject({ kind: "ready", from: "blank", payload: null, editing: false });
  });

  it("asks for the earlier form when the draft lost its copy, then carries answers over if it cannot be had", () => {
    const lost = draft({ schema: undefined });
    expect(chooseRobotForm({ live: v2, draft: lost, earlier: null })).toEqual({ kind: "fetch", schemaId: v1.id });
    const carried = chooseRobotForm({ live: v2, draft: lost, earlier: null, unavailable: new Set([v1.id]) });
    expect(carried).toMatchObject({ kind: "ready", from: "draft" });
    if (carried.kind !== "ready") throw new Error("expected ready");
    expect(carried.schema.id).toBe(v2.id);
    expect(carried.payload).toEqual({ auto_points: 4 });
    expect(carried.note).toMatch(/except 2 answers/);
  });

  it("reopens a robot you already filed under an older form with the 'already scouted' banner", () => {
    const earlier = { clientId: "filed", schemaId: v1.id, payload: { auto_points: 2 }, confidence: "high" };
    // It used to open blank, with no banner, and Save could replace the good report with nothing.
    expect(chooseRobotForm({ live: v2, draft: null, earlier })).toEqual({ kind: "fetch", schemaId: v1.id });
    const reopened = chooseRobotForm({ live: v2, draft: null, earlier, known: new Map([[v1.id, v1]]) });
    expect(reopened).toMatchObject({ kind: "ready", editing: true, from: "earlier", clientId: "filed", confidence: "high", note: EARLIER_FORM_NOTE });
    const offline = chooseRobotForm({ live: v2, draft: null, earlier, unavailable: new Set([v1.id]) });
    expect(offline).toMatchObject({ kind: "ready", editing: true, payload: { auto_points: 2 } });
  });

  it("keeps the banner when a draft edits a report you already filed", () => {
    const earlier = { clientId: "filed", schemaId: v2.id, payload: { auto_points: 2 }, confidence: "normal" };
    const choice = chooseRobotForm({ live: v2, draft: draft({ schemaId: v2.id, schema: v2, clientId: "filed" }), earlier });
    expect(choice).toMatchObject({ kind: "ready", editing: true, clientId: "filed" });
  });
});

describe("carryAnswersToForm", () => {
  it("keeps answers the new form still accepts and timed actions, and counts the rest", () => {
    const result = carryAnswersToForm(
      { auto_points: 3, fouls: 2, climb: "high", _match_capture: { bouts: [] }, _observations: { version: 1, events: [] } },
      v2.definition.fields,
    );
    expect(result.payload).toEqual({ auto_points: 3, climb: "high", _match_capture: { bouts: [] } });
    expect(result.dropped).toBe(1);
  });
});
