import { describe, expect, it } from "vitest";
import { confirmedBoardMutation } from "./mutation-result";

const board = { id: "board-1", name: "My Home", scope: "personal", layout: [] };
describe("confirmed board mutation", () => {
  it("accepts an intentionally empty saved layout and the exact board", () => {
    expect(confirmedBoardMutation(board, { id: "board-1", scope: "personal" })).toBe(true);
    expect(confirmedBoardMutation(board, { id: "another-board" })).toBe(false);
    expect(confirmedBoardMutation(board, { scope: "org" })).toBe(false);
  });
  it.each([null, {}, { ...board, layout: null }, { ...board, name: "" }, { ...board, scope: "unknown" }, { ...board, layout: [{ i: "widget", type: "unknown", x: 0, y: 0, w: 2, h: 2 }] }])("rejects incomplete acknowledgements", value => {
    expect(confirmedBoardMutation(value)).toBe(false);
  });
  it("accepts a rename without demanding an unrelated layout", () => {
    expect(confirmedBoardMutation({ id: board.id, name: "Renamed", scope: "personal" }, { id: board.id, layout: false })).toBe(true);
  });
  it("rejects duplicate IDs and invalid coordinates", () => {
    const widget = { i: "task", type: "team_todos", x: 0, y: 0, w: 4, h: 3 };
    expect(confirmedBoardMutation({ ...board, layout: [widget] })).toBe(true);
    expect(confirmedBoardMutation({ ...board, layout: [widget, widget] })).toBe(false);
    expect(confirmedBoardMutation({ ...board, layout: [{ ...widget, x: NaN }] })).toBe(false);
    expect(confirmedBoardMutation({ ...board, layout: [{ ...widget, w: 0 }] })).toBe(false);
  });
});
