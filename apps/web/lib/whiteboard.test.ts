import { describe, expect, it } from "vitest";
import {
  defaultRobots,
  FIELD_H,
  FIELD_W,
  parseWhiteboardAction,
  sanitizeRobots,
  sanitizeStrokes,
  simplifyStroke,
} from "./whiteboard";

const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

describe("simplifyStroke", () => {
  it("keeps endpoints and drops sub-epsilon jitter", () => {
    const dense: Array<[number, number]> = [
      [0, 0],
      [1, 0], // < 4 away — dropped
      [10, 0],
      [11, 0], // < 4 away from 10 — dropped
      [20, 0],
    ];
    expect(simplifyStroke(dense, 4)).toEqual([
      [0, 0],
      [10, 0],
      [20, 0],
    ]);
  });
  it("passes through short strokes untouched", () => {
    const short: Array<[number, number]> = [
      [0, 0],
      [1, 1],
    ];
    expect(simplifyStroke(short)).toEqual(short);
  });
});

describe("sanitizeStrokes", () => {
  it("accepts valid strokes and clamps out-of-field points", () => {
    const strokes = sanitizeStrokes([
      { tool: "pen", color: "red", points: [[-50, 20], [2000, 900]] },
    ]);
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.points[0]).toEqual([0, 20]);
    expect(strokes[0]!.points[1]).toEqual([FIELD_W, FIELD_H]);
  });
  it("drops degenerate strokes and rejects garbage", () => {
    expect(sanitizeStrokes([{ tool: "pen", color: "ink", points: [[1, 1]] }])).toEqual([]);
    expect(() => sanitizeStrokes([{ tool: "laser", color: "ink", points: [[0, 0], [1, 1]] }])).toThrow(/Unknown stroke tool/);
    expect(() => sanitizeStrokes([{ tool: "pen", color: "neon", points: [[0, 0], [1, 1]] }])).toThrow(/Unknown stroke color/);
    expect(() => sanitizeStrokes([{ tool: "pen", color: "ink", points: [[0, 0], ["x", 1]] }])).toThrow(/Invalid stroke point/);
    expect(() => sanitizeStrokes("scribble")).toThrow(/must be an array/);
  });
  it("treats null as empty", () => {
    expect(sanitizeStrokes(null)).toEqual([]);
  });
});

describe("sanitizeRobots", () => {
  it("falls back to the default layout for null/empty", () => {
    expect(sanitizeRobots(null)).toEqual(defaultRobots());
    expect(sanitizeRobots([])).toEqual(defaultRobots());
  });
  it("derives alliance from id, clamps coords, rejects dup/unknown ids", () => {
    const robots = sanitizeRobots([{ id: "r1", x: -20, y: 9999 }]);
    expect(robots[0]).toEqual({ id: "r1", alliance: "red", x: 0, y: FIELD_H });
    expect(() => sanitizeRobots([{ id: "r1", x: 0, y: 0 }, { id: "r1", x: 1, y: 1 }])).toThrow(/Duplicate/);
    expect(() => sanitizeRobots([{ id: "z9", x: 0, y: 0 }])).toThrow(/Unknown robot/);
  });
});

describe("parseWhiteboardAction", () => {
  it("creates a play and requires a title", () => {
    expect(parseWhiteboardAction({ action: "create_play", orgId: ORG, title: "Sneak play" })).toMatchObject({
      action: "create_play",
      title: "Sneak play",
      matchKey: null,
    });
    expect(() => parseWhiteboardAction({ action: "create_play", orgId: ORG, title: " " })).toThrow(/required/);
  });
  it("updates with sanitized strokes/robots and sparse patch", () => {
    const action = parseWhiteboardAction({
      action: "update_play",
      orgId: ORG,
      id: ID,
      strokes: [{ tool: "arrow", color: "blue", points: [[0, 0], [100, 100]] }],
    });
    expect(action).toMatchObject({ action: "update_play" });
    if (action.action === "update_play") {
      expect(action.patch.strokes).toHaveLength(1);
      expect(action.patch.robots).toBeUndefined();
    }
    expect(() => parseWhiteboardAction({ action: "update_play", orgId: ORG, id: ID })).toThrow(/No changes/);
  });
  it("rejects unsupported actions", () => {
    expect(() => parseWhiteboardAction({ action: "teleport", orgId: ORG })).toThrow(/Unsupported/);
  });
});
