// Conditional visibility ("show only when…") for scouting forms — pure helpers.
//
// The evaluator itself lives in packages/scouting (so the server-side validator and
// the tablet renderer agree on what "hidden" means). This module adds the schema-level
// checks the builder needs (cycles, dangling references) and the one helper the live
// entry form should call to decide which fields to draw:
//
//   const fields = visibleFieldsForPayload(schema.definition, payload);
//
// Hidden required fields are skipped by validatePayload, so an answer a scout could not
// see never blocks the offline sync queue.

import {
  FIELD_VISIBILITY_OPS,
  conditionHolds,
  evaluateFieldVisibility,
  visibleWhenOf,
  type FieldDefinition,
  type FieldVisibilityCondition,
  type FieldVisibilityOp,
  type SchemaDefinition,
} from "@vantage/scouting";

export { FIELD_VISIBILITY_OPS, conditionHolds, evaluateFieldVisibility, visibleWhenOf };
export type { FieldVisibilityCondition, FieldVisibilityOp };

export const VISIBILITY_OP_OPTIONS: Array<{ op: FieldVisibilityOp; label: string; needsValue: boolean }> = [
  { op: "truthy", label: "is answered / checked", needsValue: false },
  { op: "eq", label: "equals", needsValue: true },
  { op: "neq", label: "does not equal", needsValue: true },
  { op: "gt", label: "is greater than", needsValue: true },
  { op: "lt", label: "is less than", needsValue: true },
];

export function visibilityOpLabel(op: FieldVisibilityOp): string {
  return VISIBILITY_OP_OPTIONS.find((option) => option.op === op)?.label ?? op;
}

/** Fields of `definition` keyed for the evaluator. */
export function fieldsByKey(definition: Pick<SchemaDefinition, "fields">): Map<string, FieldDefinition> {
  return new Map(definition.fields.map((field) => [field.key, field]));
}

/**
 * Is one field visible for this payload? Wrapper over the shared evaluator so callers
 * do not have to build the key map themselves.
 */
export function evaluateVisibility(
  field: FieldDefinition,
  payload: Record<string, unknown>,
  definition: Pick<SchemaDefinition, "fields">,
): boolean {
  return evaluateFieldVisibility(field, payload, fieldsByKey(definition));
}

/**
 * THE helper for entry renderers: the fields to draw, in schema order, for the current
 * answers. Section headers stay visible unless they carry their own condition.
 */
export function visibleFieldsForPayload(
  definition: Pick<SchemaDefinition, "fields">,
  payload: Record<string, unknown>,
): FieldDefinition[] {
  const byKey = fieldsByKey(definition);
  return definition.fields.filter((field) => evaluateFieldVisibility(field, payload, byKey));
}

/** Keys of fields hidden for this payload — handy for "N hidden" hints. */
export function hiddenFieldKeys(
  definition: Pick<SchemaDefinition, "fields">,
  payload: Record<string, unknown>,
): string[] {
  const byKey = fieldsByKey(definition);
  return definition.fields
    .filter((field) => !evaluateFieldVisibility(field, payload, byKey))
    .map((field) => field.key);
}

/** Conditions that point at a field that does not exist (or at themselves). */
export function danglingConditions(
  definition: Pick<SchemaDefinition, "fields">,
): Array<{ fieldKey: string; missingKey: string }> {
  const keys = new Set(definition.fields.map((field) => field.key));
  const result: Array<{ fieldKey: string; missingKey: string }> = [];
  for (const field of definition.fields) {
    const condition = visibleWhenOf(field);
    if (!condition) continue;
    if (!keys.has(condition.fieldKey) || condition.fieldKey === field.key) {
      result.push({ fieldKey: field.key, missingKey: condition.fieldKey });
    }
  }
  return result;
}

/**
 * Every visibility cycle in the definition, each reported once as the ordered list of
 * field keys that chase each other (a → b → a). Empty when the graph is acyclic.
 */
export function detectConditionCycles(definition: Pick<SchemaDefinition, "fields">): string[][] {
  const next = new Map<string, string>();
  for (const field of definition.fields) {
    const condition = visibleWhenOf(field);
    if (condition) next.set(field.key, condition.fieldKey);
  }
  const cycles: string[][] = [];
  const seenCycle = new Set<string>();
  const done = new Set<string>();
  for (const start of next.keys()) {
    if (done.has(start)) continue;
    const path: string[] = [];
    const index = new Map<string, number>();
    let current: string | undefined = start;
    while (current && next.has(current) && !index.has(current) && !done.has(current)) {
      index.set(current, path.length);
      path.push(current);
      current = next.get(current);
    }
    if (current && index.has(current)) {
      const cycle = path.slice(index.get(current)!);
      const signature = [...cycle].sort().join("|");
      if (!seenCycle.has(signature)) {
        seenCycle.add(signature);
        cycles.push(cycle);
      }
    }
    for (const key of path) done.add(key);
  }
  return cycles;
}

/** Coach-facing sentences for the builder's validation list. */
export function conditionProblems(definition: Pick<SchemaDefinition, "fields">): string[] {
  const labelOf = (key: string) => definition.fields.find((field) => field.key === key)?.label ?? key;
  const problems: string[] = [];
  for (const dangling of danglingConditions(definition)) {
    problems.push(
      dangling.missingKey === dangling.fieldKey
        ? `“${labelOf(dangling.fieldKey)}” cannot depend on its own answer.`
        : `“${labelOf(dangling.fieldKey)}” is shown based on a question that no longer exists.`,
    );
  }
  for (const cycle of detectConditionCycles(definition)) {
    problems.push(`Visibility loop: ${cycle.map(labelOf).map((label) => `“${label}”`).join(" → ")} → back to the start.`);
  }
  return problems;
}
