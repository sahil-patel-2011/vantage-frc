import { describe, expect, it } from "vitest";
import { ACTION_HISTORY_KEY, actionHistory, recordScoutAction, validatePayload } from "../src/index";
import { decodeScoutQrContent, encodeScoutQrPayload } from "../src/qr-handoff";

describe("timestamped scouting actions", () => {
  const schema = { title: "Match", fields: [{ key: "cycles", label: "Cycles", type: "number" as const }] };
  it("preserves a recorded zero, corrections, timestamps and transfer history", () => {
    const first = recordScoutAction({}, { cycles: 0 }, { id: "a", at: "2026-09-26T12:00:00.000Z" });
    const next = recordScoutAction(first, { cycles: 2 }, { id: "b", at: "2026-09-26T12:00:01.100Z" });
    const undone = recordScoutAction(next, { cycles: 0 }, { id: "c", at: "2026-09-26T12:00:02.200Z" });
    expect(actionHistory(undone)?.events).toHaveLength(3);
    expect(actionHistory(first)?.events[0]?.changes[0]).toMatchObject({ beforeExists: false, before: null, afterExists: true, after: 0 });
    expect(validatePayload(schema, undone)).toEqual([]);
    const encoded = encodeScoutQrPayload([{ clientId: "entry", eventKey: "2026test", teamKey: "frc1", matchKey: "2026test_qm1", payload: undone }]);
    const decoded = decodeScoutQrContent(encoded);
    if (decoded.kind !== "embedded") throw new Error("Expected embedded transfer");
    expect(decoded.records[0]?.payload[ACTION_HISTORY_KEY]).toEqual(undone[ACTION_HISTORY_KEY]);
  });
  it("does not duplicate a replayed state update or mutate older snapshots", () => {
    const before = { cycles: 0 };
    const next = { cycles: 1 };
    const identity = { id: "same-event", at: "2026-09-26T12:00:00Z" };
    expect(recordScoutAction(before, next, identity)).toEqual(recordScoutAction(before, next, identity));
    const recorded = recordScoutAction(before, next, identity);
    next.cycles = 20;
    expect(actionHistory(recorded)?.events[0]?.changes[0]?.after).toBe(1);
    expect(actionHistory(recordScoutAction(recorded, recorded, identity))?.events).toHaveLength(1);
    expect(before).toEqual({ cycles: 0 });
  });
  it("rejects malformed, duplicate and unknown-field history on the server", () => {
    const recorded = recordScoutAction({}, { cycles: 1 }, { id: "a", at: "2026-09-26T12:00:00Z" });
    const history = actionHistory(recorded)!;
    expect(validatePayload(schema, { [ACTION_HISTORY_KEY]: { ...history, version: 2 } })).not.toEqual([]);
    expect(validatePayload(schema, { [ACTION_HISTORY_KEY]: { ...history, events: [...history.events, ...history.events] } })).not.toEqual([]);
    expect(validatePayload(schema, recordScoutAction({}, { secret: "private" }, { id: "a", at: "2026-09-26T12:00:00Z" }))).not.toEqual([]);
  });
});
