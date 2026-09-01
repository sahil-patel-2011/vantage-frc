import { describe, expect, it } from "vitest";
import { projectEventBlockers } from "./rollup";

describe("rollup barrel", () => {
  it("re-exports the one-event remaining projection", () => {
    const result = projectEventBlockers({
      eventStartDate: "2026-03-12",
      consent: { forms: [], records: [] },
      packing: { lists: 0, items: [] },
      inspection: { items: [] },
      logistics: { trips: 0, travelLegs: 0, rooms: [] },
    });
    expect(result.remaining).toBeNull();
    expect(result.sources).toHaveLength(4);
  });
});
