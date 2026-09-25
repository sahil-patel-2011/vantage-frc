import { describe, expect, it } from "vitest";
import { autoRouteConflicts, cellAt, latestAutoRoutes, secondsIntoAuto } from "./auto-paths";

const definition = { fields: [{ key: "auto_route", label: "Auto route", type: "auto_path", config: { gridCols: 6, gridRows: 3 } }] };

describe("alliance auto routes", () => {
  it("takes each team's newest route and ignores teams outside the alliance", () => {
    const routes = latestAutoRoutes(
      [
        { teamKey: "frc254", matchKey: "q9", payload: { auto_route: [0, 1, 2] }, definition },
        { teamKey: "frc254", matchKey: "q3", payload: { auto_route: [5, 4] }, definition },
        { teamKey: "frc118", matchKey: "q8", payload: { auto_route: [12, 13] }, definition },
        { teamKey: "frc999", matchKey: "q8", payload: { auto_route: [0, 1] }, definition },
      ] as never,
      ["frc254", "frc118", "frc1678"],
    );
    expect(routes.map((route) => [route.teamKey, route.route])).toEqual([
      ["frc254", [0, 1, 2]],
      ["frc118", [12, 13]],
    ]);
  });

  it("walks a route evenly through autonomous", () => {
    expect(cellAt([0, 1, 2], 0)).toBe(0);
    expect(cellAt([0, 1, 2], 0.5)).toBe(1);
    expect(cellAt([0, 1, 2], 1)).toBe(2);
  });

  it("flags two robots in the same cell at the same moment, once per pair and cell", () => {
    const grid = { gridCols: 6, gridRows: 3 };
    const conflicts = autoRouteConflicts([
      { teamKey: "frc254", route: [0, 7, 8], matchKey: null, grid },
      { teamKey: "frc118", route: [6, 7, 13], matchKey: null, grid },
      { teamKey: "frc1678", route: [17, 16], matchKey: null, grid },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ teams: ["frc254", "frc118"], cellLabel: "B2" });
    expect(secondsIntoAuto(conflicts[0]!.at)).toMatch(/about \d+ s in/);
  });
});
