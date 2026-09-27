import { describe, expect, it } from "vitest";
import { scopeObservations } from "./observation-scope";
import type { IntelScoutNote } from "../intel/intel-related";
describe("scouting evidence filters", () => {
  const rows: IntelScoutNote[] = [
    { matchKey: "2026a_qm1", confidence: "normal", payload: { cycles: 0 } },
    { matchKey: "2026a_qm2", confidence: "low", payload: { cycles: 20 } },
    { matchKey: "2026b_qm1", confidence: "high", payload: { cycles: 10 } },
  ];
  it("filters actual event and match records, keeping recorded zero", () => {
    expect(scopeObservations(rows, "2026a", "", false)).toEqual([rows[0]]);
    expect(scopeObservations(rows, "2026a", "2026a_qm2", true)).toEqual([
      rows[1],
    ]);
    expect(scopeObservations(rows, "2026b", "2026a_qm1", true)).toEqual([]);
  });
  it("includes low-confidence reports only by explicit choice", () => {
    expect(scopeObservations(rows, "", "", false)).toHaveLength(2);
    expect(scopeObservations(rows, "", "", true)).toHaveLength(3);
  });
});
