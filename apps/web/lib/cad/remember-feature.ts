/**
 * After executeComposerOp, keep the real Onshape featureId on the composer
 * step so a later run can update that feature instead of creating another.
 * Only dimension-only ops (create_sketch, create_extrude) are remembered.
 * Never invents an id. DEMO / blank values are not remembered.
 */

const DEMO_FEATURE_ID = /demo/i;

const DIMENSION_ONLY_OPS = new Set(["create_sketch", "create_extrude"]);

/** New-geometry picks. Re-edit of these ops belongs on the feature tree, not parameters.featureId. */
const ENTITY_LIST_KEYS = [
  "entities",
  "edgeIds",
  "faceIds",
  "locationIds",
  "bodyIds",
  "scopeIds",
  "featureIds",
] as const;

export type RememberableComposerOp = {
  parameters: Record<string, unknown>;
  /** Optional — cad-client may pass `{ parameters }` only. */
  operation?: string;
};

export type RememberableComposerResult = {
  featureId?: unknown;
  result?: unknown;
  [key: string]: unknown;
};

/**
 * True when parameters carry a non-empty entity pick list.
 * Those are new-geometry selections, not a dimension-only re-edit.
 */
export function hasEntityListPicks(parameters: Record<string, unknown> | null | undefined): boolean {
  if (!parameters) return false;
  return ENTITY_LIST_KEYS.some((key) => {
    const value = parameters[key];
    return Array.isArray(value) && value.length > 0;
  });
}

/**
 * Copy result.featureId (or result.result.featureId) onto parameters.featureId
 * when Onshape returned a real id and this op is dimension-only.
 */
export function rememberComposerFeature<T extends RememberableComposerOp>(
  op: T,
  result: RememberableComposerResult | null | undefined,
): T {
  const featureId =
    realReturnedId(result?.featureId) ?? realReturnedId(nestedFeatureId(result?.result));
  if (!featureId) return op;
  if (!shouldRememberFeatureId(op)) return op;
  op.parameters.featureId = featureId;
  return op;
}

function shouldRememberFeatureId(op: RememberableComposerOp): boolean {
  const operation = typeof op.operation === "string" ? op.operation.trim() : "";
  if (operation) return DIMENSION_ONLY_OPS.has(operation);
  // Backward compat: no operation field — remember unless new-geometry picks are present.
  return !hasEntityListPicks(op.parameters);
}

function nestedFeatureId(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>).featureId;
}

function realReturnedId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  if (!id || DEMO_FEATURE_ID.test(id)) return undefined;
  return id;
}
