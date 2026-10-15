import { describe, expect, it } from "vitest";
import { matchLabel, matchLabelFromKey } from "./match-label";

describe("matchLabel", () => {
  it("names a double-elimination bracket the way the field does", () => {
    expect(matchLabelFromKey("2026casj_sf1m1")).toBe("Playoff 1");
    expect(matchLabelFromKey("2025gagai_sf13m1")).toBe("Playoff 13");
    expect(matchLabelFromKey("2026casj_f1m2")).toBe("Final 2");
    expect(matchLabelFromKey("2026casj_qm12")).toBe("Qual 12");
  });

  it("keeps best-of-three rounds for events before 2023", () => {
    expect(matchLabelFromKey("2019casj_sf2m3")).toBe("Semi 2-3");
    expect(matchLabelFromKey("2019casj_qf4m1")).toBe("Quarter 4-1");
    expect(matchLabel({ compLevel: "sf", setNumber: 2, matchNumber: 1, year: 2022 })).toBe("Semi 2-1");
  });

  it("reads the parts a schedule row already has", () => {
    expect(matchLabel({ compLevel: "sf", setNumber: 7, matchNumber: 1, year: 2026 })).toBe("Playoff 7");
    expect(matchLabel({ compLevel: "qm", matchNumber: 3 })).toBe("Qual 3");
    expect(matchLabelFromKey("not a match")).toBeNull();
  });
});
