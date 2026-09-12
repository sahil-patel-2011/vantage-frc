/**
 * Map stored cache identifiers onto student-readable source names.
 * Keep raw identifiers on `source` fields; only rewrite painted text.
 */

export function studentCacheSourceLabel(source?: string | null): string {
  const key = (source ?? "").trim().toLowerCase();
  if (key === "tba" || key === "reference" || key === "") return "official matches";
  if (key === "statbotics") return "season ratings";
  if (key === "scout") return "scout notes";
  return (source ?? "").trim() || "official matches";
}
