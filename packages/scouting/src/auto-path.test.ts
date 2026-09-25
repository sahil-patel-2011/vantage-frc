import { describe, expect, it } from "vitest";
import { appendAutoPathStop, AUTO_PATH_MAX_STOPS, fieldPositionConfig, normalizeAutoPath, validatePayload } from "./index";

const field = { key: "auto_route", label: "Auto route", type: "auto_path" as const, config: { gridCols: 6, gridRows: 3 } };
const config = fieldPositionConfig(field);

describe("auto path", () => {
  it("keeps the order the robot drove and allows coming back to a cell", () => {
    expect(normalizeAutoPath([0, 7, 8, 7, 0], config)).toEqual([0, 7, 8, 7, 0]);
  });

  it("drops a double tap and cells outside the grid", () => {
    expect(normalizeAutoPath([0, 0, 7, 99, -1, 8], config)).toEqual([0, 7, 8]);
    expect(appendAutoPathStop([0, 7], 7, config)).toEqual([0, 7]);
    expect(appendAutoPathStop([0, 7], 8, config)).toEqual([0, 7, 8]);
  });

  it("stops at the most stops a real route has", () => {
    const long = Array.from({ length: 20 }, (_, index) => index % 2);
    expect(normalizeAutoPath(long, config)).toHaveLength(AUTO_PATH_MAX_STOPS);
  });

  it("rejects on the server what a tablet cannot produce", () => {
    const schema = { fields: [field] };
    expect(validatePayload(schema as never, { auto_route: [0, 7, 8] })).toEqual([]);
    expect(validatePayload(schema as never, { auto_route: [0, 0] }).join(" ")).toMatch(/twice in a row/);
    expect(validatePayload(schema as never, { auto_route: [0, 500] }).join(" ")).toMatch(/outside/);
  });
});
