import { describe, expect, it } from "vitest";
import { readinessSummary, type ReadinessSourceCounts } from "./rollup";

const NONE: ReadinessSourceCounts = { inspection: null, consent: null, packing: null, logistics: null };

describe("readinessSummary", () => {
  it("reports every source as not set up when nothing exists — never 0-of-0", () => {
    const rollups = readinessSummary(NONE);
    expect(rollups).toHaveLength(4);
    for (const rollup of rollups) {
      expect(rollup.state).toBe("not_set_up");
      expect(rollup.fraction).toBeNull();
      expect(rollup.href.startsWith("/")).toBe(true);
    }
  });

  it("treats zero-row sources the same as missing sources", () => {
    const rollups = readinessSummary({
      inspection: { totalItems: 0, passedItems: 0, failedItems: 0 },
      consent: { requiredForms: 0, peopleTracked: 0, peopleComplete: 0 },
      packing: { lists: 0, totalItems: 0, packedItems: 0 },
      logistics: { trips: 0, travelLegs: 0, roomAssignments: 0 },
    });
    for (const rollup of rollups) {
      expect(rollup.state).toBe("not_set_up");
      expect(rollup.fraction).toBeNull();
    }
  });

  it("folds live counts into honest fractions and details", () => {
    const rollups = readinessSummary({
      inspection: { totalItems: 18, passedItems: 12, failedItems: 2 },
      consent: { requiredForms: 3, peopleTracked: 14, peopleComplete: 9 },
      packing: { lists: 2, totalItems: 52, packedItems: 34 },
      logistics: { trips: 1, travelLegs: 3, roomAssignments: 8 },
    });
    const bySource = new Map(rollups.map((r) => [r.source, r]));

    const inspection = bySource.get("inspection");
    expect(inspection?.state).toBe("live");
    expect(inspection?.detail).toBe("12 of 18 items passed, 2 failing.");
    expect(inspection?.fraction).toEqual({ done: 12, total: 18 });

    const consent = bySource.get("consent");
    expect(consent?.detail).toBe("9 of 14 tracked members returned every required form.");
    expect(consent?.fraction).toEqual({ done: 9, total: 14 });

    const packing = bySource.get("packing");
    expect(packing?.detail).toBe("34 of 52 items packed across 2 lists.");

    const logistics = bySource.get("logistics");
    expect(logistics?.state).toBe("live");
    expect(logistics?.detail).toBe("Trip planned: 3 travel legs, 8 room assignments.");
    expect(logistics?.fraction).toBeNull();
  });

  it("consent with forms defined but no submissions is not set up, not 0%", () => {
    const rollups = readinessSummary({
      ...NONE,
      consent: { requiredForms: 4, peopleTracked: 0, peopleComplete: 0 },
    });
    const consent = rollups.find((r) => r.source === "consent");
    expect(consent?.state).toBe("not_set_up");
    expect(consent?.detail).toContain("no submissions tracked yet");
    expect(consent?.fraction).toBeNull();
  });

  it("packing lists without items report honestly without a fraction", () => {
    const rollups = readinessSummary({
      ...NONE,
      packing: { lists: 1, totalItems: 0, packedItems: 0 },
    });
    const packing = rollups.find((r) => r.source === "packing");
    expect(packing?.state).toBe("live");
    expect(packing?.fraction).toBeNull();
    expect(packing?.detail).toContain("no items added yet");
  });
});
