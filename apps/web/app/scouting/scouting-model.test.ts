import { describe, expect, it } from "vitest";
import { SCOUT_ENTRY_CSV_COLUMNS } from "./scouting-model";

describe("SCOUT_ENTRY_CSV_COLUMNS", () => {
  it("exports identity and confidence with the row", () => {
    expect(SCOUT_ENTRY_CSV_COLUMNS.map((column) => column.header)).toEqual([
      "Match",
      "Team",
      "Type",
      "Scout",
      "Source",
      "Confidence",
      "Updated at",
    ]);
  });
});
