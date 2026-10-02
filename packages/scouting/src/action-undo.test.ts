import { describe, expect, it } from "vitest";
import { actionHistory, recordScoutAction, undoScoutAction, undoableScoutAction, validateActionHistory } from "./action-history";
const identity = (id:string) => ({id,at:"2026-10-01T15:00:00Z"});
describe("audited scouting undo", () => {
  it("restores missing separately from an observed zero and retains the original action", () => {
    const first=recordScoutAction({}, {cycles:0}, identity("one"));
    const undone=undoScoutAction(first, identity("undo-one"));
    expect(Object.hasOwn(undone,"cycles")).toBe(false);
    expect(actionHistory(undone)?.events).toHaveLength(2);
    expect(actionHistory(undone)?.events[1]?.undoOf).toBe("one");
    expect(undoableScoutAction(undone)).toBeNull();
    expect(validateActionHistory(actionHistory(undone),new Set(["cycles"]))).toEqual([]);
  });
  it("undos multiple edits in order without undoing an undo or altering unrelated answers", () => {
    const first=recordScoutAction({notes:"Keep"}, {notes:"Keep",cycles:1},identity("one"));
    const second=recordScoutAction(first,{...first,cycles:2},identity("two"));
    const back=undoScoutAction(second,identity("undo-two"));
    expect(back.cycles).toBe(1);
    const original=undoScoutAction(back,identity("undo-one"));
    expect(original.notes).toBe("Keep");
    expect(Object.hasOwn(original,"cycles")).toBe(false);
    expect(actionHistory(original)?.events).toHaveLength(4);
    expect(undoScoutAction(original,identity("nothing"))).toBe(original);
  });
  it("accepts old histories and rejects undo references to future actions", () => {
    const original=recordScoutAction({}, {cycles:1},identity("one"));
    expect(validateActionHistory(actionHistory(original),new Set(["cycles"]))).toEqual([]);
    const forged=actionHistory(original)!;forged.events[0]!.undoOf="future";
    expect(validateActionHistory(forged,new Set(["cycles"]))).toHaveLength(1);
  });
});
