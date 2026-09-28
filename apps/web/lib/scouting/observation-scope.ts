import type { IntelScoutNote } from "../intel/intel-related";

export function observationEvent(row: IntelScoutNote): string | null {
  return (
    row.eventKey ??
    (row.matchKey?.includes("_")
      ? row.matchKey.slice(0, row.matchKey.lastIndexOf("_"))
      : null)
  );
}

export function scopeObservations(
  rows: IntelScoutNote[],
  eventKey: string,
  matchKey: string,
  includeLow: boolean,
): IntelScoutNote[] {
  return rows.filter(
    (row) =>
      (!eventKey || observationEvent(row) === eventKey) &&
      (!matchKey || row.matchKey === matchKey) &&
      (includeLow || row.confidence !== "low"),
  );
}
