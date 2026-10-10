import { describe, expect, it } from "vitest";
import type { FieldDefinition } from "../src/index";
import { officialComparisonForField, officialComparisonConfigError } from "../src/official-fields";

const field: FieldDefinition = { key: "q_7f3a", label: "Climb", type: "select", options: ["none", "deep", "shallow"] };
describe("original question official comparison", () => {
  it("uses declared meaning for opaque keys without reading labels", () => {
    expect(officialComparisonForField(field).kind).toBeNull();
    expect(officialComparisonForField({ ...field, config: { role: "endgame" } })).toMatchObject({ kind: "climb", source: "strategy" });
    expect(officialComparisonForField({ ...field, label: "Renamed", config: { officialComparison: "mobility" } })).toMatchObject({ kind: "mobility", source: "configured" });
  });
  it("respects opting out and does not infer outcomes from attempts or points", () => {
    for (const key of ["attemptedClimb", "canClimb", "endgamePoints", "climbDuration"]) {
      expect(officialComparisonForField({ ...field, key, config: { role: "endgame" } }).kind).toBeNull();
    }
    expect(officialComparisonForField({ ...field, key: "climb", config: { officialComparison: "none", role: "endgame" } }).kind).toBeNull();
    expect(officialComparisonForField({ ...field, key: "climb", config: { role: "none" } }).kind).toBeNull();
    expect(officialComparisonForField({ ...field, type: "counter", config: { role: "endgame" } }).kind).toBeNull();
  });
  it("rejects explicit unsupported rules without blocking ordinary observations", () => {
    expect(officialComparisonConfigError({ ...field, config: { officialComparison: "alliance-score" } })).toMatch(/supported/);
    expect(officialComparisonConfigError({ ...field, type: "counter", config: { officialComparison: "climb" } })).toMatch(/outcome/);
    expect(officialComparisonConfigError({ ...field, type: "counter", config: { officialComparison: "foul" } })).toBeNull();
    expect(officialComparisonConfigError({ ...field, type: "counter" })).toBeNull();
  });
});
