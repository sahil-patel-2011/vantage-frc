import {
  fieldPositionCellCount,
  fieldPositionCellLabel,
  fieldPositionConfig,
  normalizeFieldPositionCells,
  type FieldDefinition,
  type FieldPositionConfig,
  type SchemaDefinition,
} from "@vantage/scouting";

/**
 * Field-position aggregation — PURE.
 *
 * Scouts tap cells on a labeled grid; we store nothing but cell indices, so the
 * only thing there is to aggregate is "how often was each cell tapped". No game
 * art, no coordinates, no derived scoring. If nothing was recorded the result is
 * an honest empty heatmap, never a smoothed-out placeholder.
 */

export type HeatmapEntryInput = {
  payload: Record<string, unknown> | null | undefined;
};

export type HeatmapCell = {
  /** Grid cell index, row-major from the top-left. */
  cell: number;
  row: number;
  col: number;
  /** Season-proof label: column letter + row number ("C2"). */
  label: string;
  count: number;
  /** Fraction of all taps that landed here; the shares over `cells` sum to 1. */
  share: number;
};

export type FieldPositionHeatmap = {
  fieldKey: string;
  fieldLabel: string | null;
  grid: { cols: number; rows: number };
  /** Only cells with at least one tap, hottest first then by cell index. */
  cells: HeatmapCell[];
  /** Total taps across every entry — the denominator behind `share`. */
  totalTaps: number;
  /** How many entries recorded at least one cell for this field. */
  entriesWithData: number;
  /** Entries considered, whether or not they recorded a position. */
  entriesConsidered: number;
  hottest: HeatmapCell | null;
};

export type FieldPositionField = {
  key: string;
  label: string;
  config: FieldPositionConfig;
};

/** Every field_position field in a published schema definition, in form order. */
export function findFieldPositionFields(
  definition: SchemaDefinition | null | undefined,
): FieldPositionField[] {
  const fields = definition?.fields;
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((field): field is FieldDefinition => Boolean(field) && field.type === "field_position")
    .map((field) => ({
      key: field.key,
      label: field.label,
      config: fieldPositionConfig(field),
    }));
}

export function emptyFieldPositionHeatmap(
  fieldKey: string,
  grid: FieldPositionConfig,
  options?: { fieldLabel?: string | null; entriesConsidered?: number },
): FieldPositionHeatmap {
  return {
    fieldKey,
    fieldLabel: options?.fieldLabel ?? null,
    grid: { cols: grid.gridCols, rows: grid.gridRows },
    cells: [],
    totalTaps: 0,
    entriesWithData: 0,
    entriesConsidered: options?.entriesConsidered ?? 0,
    hottest: null,
  };
}

/**
 * Aggregate one field_position field across scout entries.
 *
 * Cells outside the grid (or outside `allowedCells`) are dropped rather than
 * counted — an entry saved against an older, wider grid must not invent taps in
 * cells the current form does not have.
 */
export function readFieldPositionHeatmap(
  entries: readonly HeatmapEntryInput[],
  fieldKey: string,
  grid: FieldPositionConfig,
  options?: { fieldLabel?: string | null },
): FieldPositionHeatmap {
  const entriesConsidered = entries.length;
  const counts = new Map<number, number>();
  let totalTaps = 0;
  let entriesWithData = 0;

  for (const entry of entries) {
    const raw = entry?.payload?.[fieldKey];
    const cells = normalizeFieldPositionCells(raw, grid);
    if (!cells.length) continue;
    entriesWithData += 1;
    for (const cell of cells) {
      counts.set(cell, (counts.get(cell) ?? 0) + 1);
      totalTaps += 1;
    }
  }

  if (!totalTaps) {
    return emptyFieldPositionHeatmap(fieldKey, grid, {
      fieldLabel: options?.fieldLabel ?? null,
      entriesConsidered,
    });
  }

  const cells: HeatmapCell[] = [...counts.entries()]
    .map(([cell, count]) => ({
      cell,
      row: Math.floor(cell / grid.gridCols),
      col: cell % grid.gridCols,
      label: fieldPositionCellLabel(cell, grid),
      count,
      share: count / totalTaps,
    }))
    .sort((a, b) => b.count - a.count || a.cell - b.cell);

  return {
    fieldKey,
    fieldLabel: options?.fieldLabel ?? null,
    grid: { cols: grid.gridCols, rows: grid.gridRows },
    cells,
    totalTaps,
    entriesWithData,
    entriesConsidered,
    hottest: cells[0] ?? null,
  };
}

/** Every field_position field in a schema, aggregated over the same entries. */
export function readAllFieldPositionHeatmaps(
  entries: readonly HeatmapEntryInput[],
  definition: SchemaDefinition | null | undefined,
): FieldPositionHeatmap[] {
  return findFieldPositionFields(definition).map((field) =>
    readFieldPositionHeatmap(entries, field.key, field.config, { fieldLabel: field.label }),
  );
}

/** Dense grid for rendering — every cell, including the cold ones. */
export function heatmapCellGrid(heatmap: FieldPositionHeatmap): HeatmapCell[] {
  const config: FieldPositionConfig = {
    gridCols: heatmap.grid.cols,
    gridRows: heatmap.grid.rows,
    allowedCells: null,
  };
  const byCell = new Map(heatmap.cells.map((cell) => [cell.cell, cell]));
  return Array.from({ length: fieldPositionCellCount(config) }, (_, cell) => {
    const hit = byCell.get(cell);
    if (hit) return hit;
    return {
      cell,
      row: Math.floor(cell / heatmap.grid.cols),
      col: cell % heatmap.grid.cols,
      label: fieldPositionCellLabel(cell, config),
      count: 0,
      share: 0,
    };
  });
}

/**
 * 0..1 intensity relative to the hottest cell, for a background alpha.
 * Relative (not absolute) so a grid with 4 total taps still reads, and it never
 * implies a count that was not recorded.
 */
export function heatmapCellIntensity(cell: HeatmapCell, heatmap: FieldPositionHeatmap): number {
  const peak = heatmap.hottest?.count ?? 0;
  if (!peak || !cell.count) return 0;
  return cell.count / peak;
}

export function formatHeatmapShare(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return "0%";
  const percent = share * 100;
  return `${percent >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10}%`;
}

/** Honest one-liner for a heat grid caption — never fabricates a sample. */
export function heatmapSummaryLine(heatmap: FieldPositionHeatmap): string {
  if (!heatmap.totalTaps) {
    return heatmap.entriesConsidered
      ? "No positions recorded yet on this form."
      : "No scout entries yet.";
  }
  const hottest = heatmap.hottest;
  const entryText = `${heatmap.entriesWithData} entr${heatmap.entriesWithData === 1 ? "y" : "ies"}`;
  return hottest
    ? `${heatmap.totalTaps} tap${heatmap.totalTaps === 1 ? "" : "s"} from ${entryText} · hottest ${hottest.label} (${formatHeatmapShare(hottest.share)})`
    : `${heatmap.totalTaps} taps from ${entryText}`;
}
