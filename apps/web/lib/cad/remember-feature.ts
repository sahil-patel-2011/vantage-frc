/**
 * After executeComposerOp, keep the real Onshape featureId on the composer
 * step so a later run can update that feature instead of creating another.
 * Never invents an id. DEMO / blank values are not remembered.
 */

const DEMO_FEATURE_ID = /demo/i;

export type RememberableComposerOp = {
  parameters: Record<string, unknown>;
};

export type RememberableComposerResult = {
  featureId?: unknown;
  result?: unknown;
  [key: string]: unknown;
};

/**
 * Copy result.featureId (or result.result.featureId) onto parameters.featureId
 * when Onshape returned a real id.
 */
export function rememberComposerFeature<T extends RememberableComposerOp>(
  op: T,
  result: RememberableComposerResult | null | undefined,
): T {
  const featureId =
    realReturnedId(result?.featureId) ?? realReturnedId(nestedFeatureId(result?.result));
  if (!featureId) return op;
  op.parameters.featureId = featureId;
  return op;
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
