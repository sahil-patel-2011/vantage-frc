import { CAPTURE_KINDS, captureSummary, matchCapture, type FieldDefinition } from "@vantage/scouting";

/** Analysis-only projection: keep raw payloads unchanged and use the usual match deduplication. */
export function withActivityMetrics<T extends { payload: Record<string, unknown>; fields?: FieldDefinition[] }>(row: T): T {
  const capture = matchCapture(row.payload);
  if (!capture || Object.hasOwn(row.payload, "recordedActivity")) return row;
  const summary = captureSummary(capture);
  const values: Record<string, number> = {};
  const fields = [...(row.fields ?? [])];
  for (const kind of CAPTURE_KINDS) {
    const metric = summary[kind];
    if (!metric.bouts) continue;
    for (const [suffix, label, value, unit] of [
      ["seconds", "Observed duration", metric.seconds, "seconds"],
      ["bouts", "Recorded bouts", metric.bouts, "bouts"],
      ["fuelPerSecond", "Observed throughput", metric.perSecond, "fuel/second"],
      ["countedSeconds", "Counted observation time", metric.countedBouts ? metric.countedSeconds : null, "seconds"],
    ] as const) {
      if (value === null) continue;
      const key = `${kind}_${suffix}`;
      values[key] = value;
      fields.push({ key: `recordedActivity.${key}`, label: `${kind.charAt(0).toUpperCase()}${kind.slice(1)} · ${label}`, type: "number", config: { unit },
        helpText: "Derived from completed, non-removed match-relative bouts. Throughput uses only intervals with a counted release; it is not official scoring or a full-match estimate. Duplicate reports receive equal weight within a match, then matches receive equal weight." });
    }
  }
  return { ...row, payload: { ...row.payload, recordedActivity: values }, fields };
}
