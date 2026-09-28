export type ObservationRow = { teamKey?: string | null; matchKey?: string | null; payload: Record<string, unknown> };
export type ObservationConflict = { matchKey: string; field: string; values: unknown[] };

/** Expand structured counters and selections without turning missing observations into zero. */
export function observationFields(payload: Record<string, unknown>, selectionOptions: ReadonlyMap<string, ReadonlySet<string>> = new Map()): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  function visit(key: string, value: unknown, depth: number) {
    if (key.startsWith("_") || depth > 3) return;
    if (Array.isArray(value)) {
      if (value.every((item) => typeof item === "string")) {
        const selected = new Set(value as string[]);
        for (const option of selectionOptions.get(key) ?? selected) output[`${key}.${option}`] = selected.has(option);
      }
      return;
    }
    if (value && typeof value === "object") {
      for (const [child, nested] of Object.entries(value)) visit(`${key}.${child}`, nested, depth + 1);
      return;
    }
    output[key] = value;
  }
  for (const [key, value] of Object.entries(payload)) visit(key, value, 0);
  return output;
}

/** Reduce robot/match reports before averaging; pit entries remain separate observations. */
export function combineObservations(rows: readonly ObservationRow[]): { rows: ObservationRow[]; conflicts: ObservationConflict[] } {
  // A recorded selection list (including []) observes every known option. A missing
  // list observes none. Discover the options before flattening so selection rates
  // include explicit negatives without manufacturing answers for absent reports.
  const selectionOptions = new Map<string, Set<string>>();
  function discover(payload: Record<string, unknown>, prefix = "", depth = 0) {
    if (depth > 3) return;
    for (const [field, value] of Object.entries(payload)) {
      const key = prefix ? `${prefix}.${field}` : field;
      if (key.startsWith("_")) continue;
      if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
        const options = selectionOptions.get(key) ?? new Set<string>();
        value.forEach((item: string) => options.add(item));
        selectionOptions.set(key, options);
      } else if (value && typeof value === "object" && !Array.isArray(value)) discover(value as Record<string, unknown>, key, depth + 1);
    }
  }
  rows.forEach((row) => discover(row.payload));
  const groups = new Map<string, ObservationRow[]>();
  rows.forEach((row, index) => {
    const key = row.matchKey ? `${row.teamKey ?? ""}:${row.matchKey}` : `pit:${index}`;
    const group = groups.get(key) ?? [];
    group.push({ ...row, payload: observationFields(row.payload, selectionOptions) });
    groups.set(key, group);
  });
  const conflicts: ObservationConflict[] = [];
  const combined = [...groups.values()].map((group) => {
    const first = group[0]!;
    const payload: Record<string, unknown> = {};
    const keys = new Set(group.flatMap((row) => Object.keys(row.payload)));
    for (const field of keys) {
      const values = group.map((row) => row.payload[field]).filter((value) => value != null && value !== "");
      if (!values.length) continue;
      const normalized = values.map((value) => typeof value === "string" && /^(yes|true|y|no|false|n)$/i.test(value.trim())
        ? /^(yes|true|y)$/i.test(value.trim()) : value);
      const unique = new Set(normalized.map((value) => JSON.stringify(value)));
      if (unique.size > 1 && first.matchKey) conflicts.push({ matchKey: first.matchKey, field, values });
      if (normalized.every((value) => typeof value === "number" && Number.isFinite(value))) {
        payload[field] = (normalized as number[]).reduce((sum, value) => sum + value, 0) / normalized.length;
      } else if (group.length === 1 || unique.size === 1) {
        payload[field] = values[0];
      } else {
        const votes = new Map<string, { value: unknown; count: number }>();
        for (const value of normalized) {
          const key = JSON.stringify(value);
          const vote = votes.get(key) ?? { value, count: 0 };
          vote.count++;
          votes.set(key, vote);
        }
        const sorted = [...votes.values()].sort((a, b) => b.count - a.count);
        if (sorted[0]!.count > (sorted[1]?.count ?? 0)) payload[field] = sorted[0]!.value;
        // A tied disagreement remains unknown, not an invented affirmative/negative.
      }
    }
    return { ...first, payload };
  });
  return { rows: combined, conflicts };
}
