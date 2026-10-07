import { describe, expect, it } from "vitest";
import { scoutFieldProblem } from "./scouting-form-focus";

describe("scouting validation identifies the right question", () => {
  const fields = [
    { key: "fuel", label: "Fuel", type: "number" as const },
    { key: "passed", label: "Fuel passed", type: "number" as const },
  ];
  it("does not attach a longer question's error to its shorter prefix", () => {
    expect(scoutFieldProblem(fields[0]!, fields, ["Fuel passed is required"])).toBeUndefined();
    expect(scoutFieldProblem(fields[1]!, fields, ["Fuel passed is required"])).toBe("Fuel passed is required");
  });
  it("keeps unrelated activity errors in the summary", () => {
    expect(scoutFieldProblem(fields[0]!, fields, ["Stop the current match activity before saving"])).toBeUndefined();
  });
});
