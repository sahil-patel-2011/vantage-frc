import { describe, expect, it } from "vitest";
import { fieldPositionConfig, type SchemaDefinition } from "@vantage/scouting";
import {
  emptyFieldPositionHeatmap,
  findFieldPositionFields,
  formatHeatmapShare,
  heatmapCellGrid,
  heatmapCellIntensity,
  heatmapSummaryLine,
  readAllFieldPositionHeatmaps,
  readFieldPositionHeatmap,
} from "./heatmap";

const grid = fieldPositionConfig({ config: { gridCols: 4, gridRows: 3 } });

const definition: SchemaDefinition = {
  title: "Match",
  fields: [
    { key: "auto_section", label: "Auto", type: "section_header" },
    { key: "cycles", label: "Cycles", type: "counter" },
    {
      key: "scoring_spots",
      label: "Scoring spots",
      type: "field_position",
      config: { gridCols: 4, gridRows: 3 },
    },
  ],
};

describe("readFieldPositionHeatmap", () => {
  it("aggregates taps and shares that sum to 1", () => {
    const heatmap = readFieldPositionHeatmap(
      [
        { payload: { scoring_spots: [1, 5] } },
        { payload: { scoring_spots: [1] } },
        { payload: { scoring_spots: [1, 5, 9] } },
      ],
      "scoring_spots",
      grid,
      { fieldLabel: "Scoring spots" },
    );
    expect(heatmap.totalTaps).toBe(6);
    expect(heatmap.entriesWithData).toBe(3);
    expect(heatmap.entriesConsidered).toBe(3);
    expect(heatmap.cells.map((cell) => [cell.cell, cell.count])).toEqual([
      [1, 3],
      [5, 2],
      [9, 1],
    ]);
    const shareSum = heatmap.cells.reduce((sum, cell) => sum + cell.share, 0);
    expect(shareSum).toBeCloseTo(1, 10);
    expect(heatmap.hottest?.cell).toBe(1);
    expect(heatmap.hottest?.label).toBe("B1");
    expect(heatmap.hottest?.share).toBeCloseTo(0.5, 10);
  });

  it("gives row/col coordinates and season-proof labels", () => {
    const heatmap = readFieldPositionHeatmap(
      [{ payload: { scoring_spots: [6] } }],
      "scoring_spots",
      grid,
    );
    expect(heatmap.cells[0]).toMatchObject({ cell: 6, row: 1, col: 2, label: "C2", count: 1 });
  });

  it("returns an honest empty heatmap rather than a fabricated one", () => {
    const noEntries = readFieldPositionHeatmap([], "scoring_spots", grid);
    expect(noEntries.totalTaps).toBe(0);
    expect(noEntries.cells).toEqual([]);
    expect(noEntries.hottest).toBeNull();
    expect(heatmapSummaryLine(noEntries)).toBe("No scout entries yet.");

    const noPositions = readFieldPositionHeatmap(
      [{ payload: { cycles: 4 } }, { payload: null }, { payload: { scoring_spots: [] } }],
      "scoring_spots",
      grid,
    );
    expect(noPositions.totalTaps).toBe(0);
    expect(noPositions.entriesConsidered).toBe(3);
    expect(noPositions.entriesWithData).toBe(0);
    expect(heatmapSummaryLine(noPositions)).toBe("No positions recorded yet on this form.");
  });

  it("drops cells that fall outside the current grid instead of inventing taps", () => {
    const heatmap = readFieldPositionHeatmap(
      [{ payload: { scoring_spots: [2, 40, -3, "x", 2] } }],
      "scoring_spots",
      grid,
    );
    expect(heatmap.totalTaps).toBe(1);
    expect(heatmap.cells.map((cell) => cell.cell)).toEqual([2]);
  });

  it("respects an allowedCells whitelist", () => {
    const restricted = fieldPositionConfig({
      config: { gridCols: 4, gridRows: 3, allowedCells: [0, 1] },
    });
    const heatmap = readFieldPositionHeatmap(
      [{ payload: { scoring_spots: [0, 7] } }],
      "scoring_spots",
      restricted,
    );
    expect(heatmap.cells.map((cell) => cell.cell)).toEqual([0]);
    expect(heatmap.totalTaps).toBe(1);
  });

  it("breaks count ties by cell index so ordering is stable", () => {
    const heatmap = readFieldPositionHeatmap(
      [{ payload: { scoring_spots: [9, 3, 6] } }],
      "scoring_spots",
      grid,
    );
    expect(heatmap.cells.map((cell) => cell.cell)).toEqual([3, 6, 9]);
  });
});

describe("schema discovery and rendering helpers", () => {
  it("finds field_position fields in a published definition", () => {
    expect(findFieldPositionFields(definition).map((field) => field.key)).toEqual(["scoring_spots"]);
    expect(findFieldPositionFields(definition)[0]?.config.gridCols).toBe(4);
    expect(findFieldPositionFields(null)).toEqual([]);
    expect(findFieldPositionFields({ title: "x", fields: [] })).toEqual([]);
  });

  it("aggregates every position field on the schema over the same entries", () => {
    const maps = readAllFieldPositionHeatmaps(
      [{ payload: { scoring_spots: [1] } }],
      definition,
    );
    expect(maps).toHaveLength(1);
    expect(maps[0]?.fieldLabel).toBe("Scoring spots");
    expect(maps[0]?.totalTaps).toBe(1);
  });

  it("keeps a present-but-empty heatmap when the question exists but nobody tapped", () => {
    // This is the contract the pick desk relies on: the panel renders and says
    // "no positions recorded yet" instead of vanishing or inventing heat.
    const maps = readAllFieldPositionHeatmaps(
      [{ payload: { cycles: 3 } }, { payload: { cycles: 1 } }],
      definition,
    );
    expect(maps).toHaveLength(1);
    expect(maps[0]?.fieldKey).toBe("scoring_spots");
    expect(maps[0]?.totalTaps).toBe(0);
    expect(maps[0]?.entriesConsidered).toBe(2);
    expect(maps[0]?.grid).toEqual({ cols: 4, rows: 3 });
    expect(heatmapCellGrid(maps[0]!).every((cell) => cell.count === 0)).toBe(true);
    expect(heatmapSummaryLine(maps[0]!)).toBe("No positions recorded yet on this form.");
  });

  it("expands to a dense grid with zero-count cold cells", () => {
    // A cell is tapped or not within one entry, so two entries are needed for a count of 2.
    const heatmap = readFieldPositionHeatmap(
      [{ payload: { scoring_spots: [1, 5] } }, { payload: { scoring_spots: [1] } }],
      "scoring_spots",
      grid,
    );
    const cells = heatmapCellGrid(heatmap);
    expect(cells).toHaveLength(12);
    expect(cells[0]).toMatchObject({ cell: 0, count: 0, share: 0, label: "A1" });
    expect(cells[1]?.count).toBe(2);
    expect(heatmapCellIntensity(cells[1]!, heatmap)).toBe(1);
    expect(heatmapCellIntensity(cells[5]!, heatmap)).toBeCloseTo(0.5, 10);
    expect(heatmapCellIntensity(cells[0]!, heatmap)).toBe(0);
  });

  it("formats shares and an honest summary line", () => {
    expect(formatHeatmapShare(0)).toBe("0%");
    expect(formatHeatmapShare(0.5)).toBe("50%");
    expect(formatHeatmapShare(0.034)).toBe("3.4%");
    const empty = emptyFieldPositionHeatmap("scoring_spots", grid, { entriesConsidered: 2 });
    expect(empty.grid).toEqual({ cols: 4, rows: 3 });
    expect(heatmapSummaryLine(empty)).toBe("No positions recorded yet on this form.");
    const hot = readFieldPositionHeatmap([{ payload: { scoring_spots: [1] } }], "scoring_spots", grid);
    expect(heatmapSummaryLine(hot)).toBe("1 tap from 1 entry · hottest B1 (100%)");
  });
});
