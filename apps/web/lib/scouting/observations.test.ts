import { describe, expect, it } from "vitest";
import { combineObservations } from "./observations";
import { buildScoutBreakdown } from "./scout-breakdown";
describe("robot/match observations", () => {
  it("does not overweight a match with several reports or confuse missing with zero", () => {
    const result = buildScoutBreakdown([
      { matchKey: "a_qm1", payload: { cycles: 0 } },
      { matchKey: "a_qm1", payload: { cycles: 4 } },
      { matchKey: "a_qm2", payload: { cycles: 10 } },
      { matchKey: "a_qm3", payload: {} },
    ]);
    expect(result.matches).toBe(3);
    expect(result.fields.find((field) => field.key === "cycles")).toMatchObject({ kind: "number", mean: 6 });
    expect(result.disagreements).toHaveLength(1);
  });
  it("keeps tied categorical answers unknown and separate robots separate", () => {
    const result = combineObservations([
      { teamKey: "frc1", matchKey: "m", payload: { climb: "yes", counter: { high: 2 } } },
      { teamKey: "frc1", matchKey: "m", payload: { climb: "no", counter: { high: 4 } } },
      { teamKey: "frc2", matchKey: "m", payload: { climb: "yes" } },
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.payload).toEqual({ "counter.high": 3 });
    expect(result.conflicts).toHaveLength(2);
  });
  it("counts explicit empty selections as false while missing reports remain unknown", () => {
    const result = combineObservations([
      { matchKey: "qm1", payload: { capabilities: ["high", "low"] } },
      { matchKey: "qm2", payload: { capabilities: ["low"] } },
      { matchKey: "qm3", payload: { capabilities: [] } },
      { matchKey: "qm4", payload: {} },
    ]);
    expect(result.rows.map((row) => row.payload["capabilities.high"])).toEqual([true, false, false, undefined]);
    expect(result.rows.map((row) => row.payload["capabilities.low"])).toEqual([true, true, false, undefined]);
    const disagreement = combineObservations([
      { matchKey: "qm1", payload: { capabilities: ["high"] } },
      { matchKey: "qm1", payload: { capabilities: [] } },
    ]);
    expect(disagreement.rows[0]!.payload).toEqual({});
    expect(disagreement.conflicts).toEqual([{ matchKey: "qm1", field: "capabilities.high", values: [true, false] }]);
  });
});
