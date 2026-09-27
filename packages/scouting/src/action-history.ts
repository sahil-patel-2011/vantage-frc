export const ACTION_HISTORY_KEY = "_observations";
export type ScoutActionChange = { field: string; beforeExists: boolean; afterExists: boolean; before: unknown; after: unknown };
export type ScoutAction = { id: string; at: string; changes: ScoutActionChange[] };
export type ScoutActionHistory = { version: 1; events: ScoutAction[] };

export function actionHistory(payload: Record<string, unknown>): ScoutActionHistory | null {
  const value = payload[ACTION_HISTORY_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const history = value as ScoutActionHistory;
  return history.version === 1 && Array.isArray(history.events) ? history : null;
}

/** The caller supplies identity/time once, outside React's replayable state updater. */
export function recordScoutAction(before: Record<string, unknown>, after: Record<string, unknown>, identity: Pick<ScoutAction, "id" | "at">): Record<string, unknown> {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: ScoutActionChange[] = [];
  for (const field of keys) {
    if (field.startsWith("_")) continue;
    const beforeExists = Object.hasOwn(before, field);
    const afterExists = Object.hasOwn(after, field);
    if (beforeExists === afterExists && JSON.stringify(before[field]) === JSON.stringify(after[field])) continue;
    changes.push({ field, beforeExists, afterExists, before: before[field] === undefined ? null : JSON.parse(JSON.stringify(before[field])), after: after[field] === undefined ? null : JSON.parse(JSON.stringify(after[field])) });
  }
  const previous = actionHistory(before);
  if (!changes.length) return { ...after, ...(previous ? { [ACTION_HISTORY_KEY]: previous } : {}) };
  return { ...after, [ACTION_HISTORY_KEY]: { version: 1, events: [...(previous?.events ?? []), { ...identity, changes }] } satisfies ScoutActionHistory };
}

export function validateActionHistory(value: unknown, fields: ReadonlySet<string>): string[] {
  if (value === undefined) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["Observation history must be an object"];
  const history = value as Partial<ScoutActionHistory>;
  if (history.version !== 1 || !Array.isArray(history.events) || history.events.length > 10000) return ["Observation history has an unsupported version or length"];
  const ids = new Set<string>();
  for (const event of history.events) {
    if (!event || typeof event.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(event.id) || ids.has(event.id) || typeof event.at !== "string" || !Number.isFinite(Date.parse(event.at)) || !Array.isArray(event.changes) || !event.changes.length || event.changes.length > fields.size) return ["Observation history contains an invalid action"];
    ids.add(event.id);
    const changed = new Set<string>();
    for (const change of event.changes) {
      if (!change || !fields.has(change.field) || changed.has(change.field) || typeof change.beforeExists !== "boolean" || typeof change.afterExists !== "boolean" || !Object.hasOwn(change, "before") || !Object.hasOwn(change, "after")) return ["Observation history contains an invalid field change"];
      changed.add(change.field);
    }
  }
  return [];
}
