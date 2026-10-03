import { isLayoutOnlyField, type FieldDefinition } from "@vantage/scouting";

/** `scoutId` / `scout` are only sent to team leads; `mine` marks the reader's own rows. */
export type FormResponseRow = {
  id: string; team: string; label: string; event: string | null; payload: Record<string, unknown>; observedAt: string;
  scoutId?: string; scout?: string; mine?: boolean;
};
/** One scout's total over every response to the form, not only the rows on this page. */
export type ScoutTotal = { id: string; name: string; total: number; teams: number; lastAt: string };

export function responseValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(responseValue).join(", ");
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
/** Missing answers stay missing. Counts describe observed answers, not robots. */
export function responseSummary(field: FieldDefinition, rows: FormResponseRow[]) {
  const values = rows.slice().reverse().flatMap(row => {
    const value = row.payload[field.key];
    return value === undefined || value === null || value === "" ? [] : [value];
  });
  const numeric = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const counts = new Map<string, number>();
  for (const value of values) for (const item of Array.isArray(value) ? value : [value]) {
    const label = responseValue(item); counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const chart = field.config?.chart;
  const auto = field.type === "number" || field.type === "counter" || field.type === "rating" || field.type === "slider" ? "trend" :
    ["boolean", "select", "dropdown", "multiple_choice", "multi_select", "drivetrain_type"].includes(field.type) ? "bar" : "none";
  return { n: values.length, mean: numeric.length ? numeric.reduce((a,b) => a+b,0) / numeric.length : null,
    numeric, counts: [...counts].sort((a,b) => b[1]-a[1]), chart: isLayoutOnlyField(field) ? "none" : chart ?? auto };
}

/** The numbers above the responses. Nothing is estimated: an empty list has no latest time. */
export function responseOverview(rows: FormResponseRow[]) {
  return {
    responses: rows.length,
    teams: new Set(rows.map(row => row.team)).size,
    mine: rows.filter(row => row.mine).length,
    latest: rows.reduce<string | null>((latest, row) => !latest || row.observedAt > latest ? row.observedAt : latest, null),
  };
}

/**
 * Who filed what, most responses first. Totals come from the server (`scouts`) so a scout
 * with more responses than the page holds is still counted in full; `rows` is the part of
 * their work that is loaded and can be listed. With `filtered`, the count is what the
 * current filter leaves, and a scout it leaves with nothing is dropped.
 */
export function responsesByScout(scouts: ScoutTotal[], rows: FormResponseRow[], filtered = false) {
  const byScout = new Map<string, FormResponseRow[]>();
  for (const row of rows) if (row.scoutId) byScout.set(row.scoutId, [...(byScout.get(row.scoutId) ?? []), row]);
  return scouts
    .map(scout => {
      const own = byScout.get(scout.id) ?? [];
      return { ...scout, rows: own, count: filtered ? own.length : scout.total };
    })
    .filter(scout => scout.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function responsesCsv(fields: FieldDefinition[], rows: FormResponseRow[]): string {
  const cell = (value: string) => `"${(/^[=+@\-\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`;
  // The Scout column exists only in a lead's export: nobody else is sent the names.
  const withScout = rows.some(row => row.scout !== undefined);
  return [["Team", "Match / report", "Event", "Recorded", ...(withScout ? ["Scout"] : []), ...fields.map(field => field.label)],
    ...rows.map(row => [row.team.replace(/^frc/, ""), row.label, row.event ?? "Practice", row.observedAt, ...(withScout ? [row.scout ?? ""] : []),
      ...fields.map(field => responseValue(row.payload[field.key]))])].map(row => row.map(cell).join(",")).join("\r\n");
}
