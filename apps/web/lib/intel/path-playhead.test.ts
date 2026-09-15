import { describe, expect, it } from "vitest";
import {
  ROBOT_RADIUS_IN,
  fieldBoundsForPaths,
  interpolatePath,
  pathFromUnknown,
  pathsFromScoutPayloads,
  playheadConflicts,
  playheadRange,
  playheadSample,
} from "./path-playhead";

const a = [
  { t: 0, x: 0, y: 0 },
  { t: 2, x: 20, y: 0 },
];
const b = [
  { t: 0, x: 4, y: 0 },
  { t: 2, x: 24, y: 0 },
];
const far = [
  { t: 0, x: 80, y: 80 },
  { t: 2, x: 90, y: 80 },
];

describe("interpolatePath", () => {
  it("needs a real path before sampling", () => {
    expect(interpolatePath([], 1)).toBeNull();
    expect(interpolatePath(a, 1)).toEqual({ t: 1, x: 10, y: 0 });
  });
});

describe("pathsFromScoutPayloads", () => {
  it("reads real waypoints and skips empty or one-point poses", () => {
    expect(pathFromUnknown([{ x: 1, y: 2 }])).toBeNull();
    expect(pathsFromScoutPayloads([{}])).toEqual([]);
    const paths = pathsFromScoutPayloads([
      {
        autoPath: [
          { t: 0, x: 4, y: 8 },
          { t: 2, x: 20, y: 8 },
        ],
      },
    ]);
    expect(paths).toHaveLength(1);
    expect(paths[0]?.[1]).toEqual({ t: 2, x: 20, y: 8 });
    expect(fieldBoundsForPaths(paths).width).toBe(54);
    expect(playheadRange(paths)).toEqual({ min: 0, max: 2 });
  });
});

describe("playheadConflicts", () => {
  it("flags robots closer than two radii and skips empty paths", () => {
    expect(playheadSample([a, []], 1)[1]).toBeNull();
    const hits = playheadConflicts([a, b], 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.distance).toBeLessThan(ROBOT_RADIUS_IN * 2);
    expect(playheadConflicts([a, far], 1)).toEqual([]);
  });
});
