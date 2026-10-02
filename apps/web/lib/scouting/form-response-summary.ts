import { isLayoutOnlyField, type FieldDefinition } from "@vantage/scouting";

export type FormResponseRow = { id: string; team: string; label: string; event: string | null; payload: Record<string, unknown>; observedAt: string };
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

export function responsesCsv(fields: FieldDefinition[], rows: FormResponseRow[]): string {
  const cell = (value: string) => `"${(/^[=+@\-\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`;
  return [["Team", "Match / report", "Event", "Recorded", ...fields.map(field => field.label)],
    ...rows.map(row => [row.team.replace(/^frc/, ""), row.label, row.event ?? "Practice", row.observedAt,
      ...fields.map(field => responseValue(row.payload[field.key]))])].map(row => row.map(cell).join(",")).join("\r\n");
}
