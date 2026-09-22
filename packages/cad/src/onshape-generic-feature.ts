/**
 * Build any Onshape feature from its own published spec.
 *
 * The agent had hand-written tools for about a dozen features — extrude,
 * fillet, chamfer, a few sketches — while the account's `featurespecs`
 * endpoint reports **97** feature types, each declaring its own parameters.
 * Loft, sweep, revolve, shell, draft, helix, thread, the whole sheet-metal
 * family and every custom FeatureScript the team writes were simply
 * unreachable, and closing that by hand would mean writing (and then
 * maintaining) eighty-five more tools.
 *
 * So this does not know about features at all. Hand it the spec Onshape
 * published and a plain `{ parameterId: value }` map, and it assembles the BTM
 * payload by dispatching on what the spec says each parameter is. A feature
 * added to Onshape next year works the day it ships.
 *
 * COVERAGE, counted across all 97 specs on a live account (2026-09-18):
 *
 *   BTParameterSpecQuantity-173   431   LENGTH 261, ANGLE 58, REAL 56, INTEGER 48, ANYTHING 8
 *   BTParameterSpecBoolean-170    396
 *   BTParameterSpecQuery-174      314
 *   BTParameterSpecEnum-171       225
 *   ----------------------------------
 *   the four above               1366 of 1444 parameters — 95%
 *
 * The remaining 78 are arrays, lookup tables, foreign ids and references to
 * other documents. Those are refused by name rather than guessed at: a wrong
 * parameter does not fail loudly, it builds the wrong geometry.
 */

import {
  angleParameter,
  booleanParameter,
  countParameter,
  deterministicQueryParameter,
  enumParameter,
  quantityParameter,
} from "./onshape-features";

/** One parameter as Onshape's `featurespecs` describes it. */
export type OnshapeParameterSpec = {
  btType: string;
  parameterId: string;
  parameterName?: string;
  /** Quantity only: LENGTH | ANGLE | INTEGER | REAL | ANYTHING. */
  quantityType?: string;
  /** Enum only. */
  enumName?: string;
  options?: unknown[];
};

/** One feature as Onshape's `featurespecs` describes it. */
export type OnshapeFeatureSpec = {
  featureType: string;
  featureTypeName?: string;
  parameters?: OnshapeParameterSpec[];
};

export type GenericFeatureValues = Record<string, unknown>;

/** Spec btTypes this builder understands, by the family Onshape gives them. */
const QUANTITY = "BTParameterSpecQuantity-173";
const BOOLEAN = "BTParameterSpecBoolean-170";
const QUERY = "BTParameterSpecQuery-174";
const ENUM = "BTParameterSpecEnum-171";

/** Readable names for the spec kinds we deliberately refuse. */
const UNSUPPORTED_LABELS: Record<string, string> = {
  "BTParameterSpecArray-2600": "a repeating array of sub-parameters",
  "BTParameterSpecLookupTablePath-761": "a lookup-table path",
  "BTParameterSpecFeatureList-703": "a feature list",
  "BTParameterSpecString-175": "a string",
  "BTParameterSpecButton-4111": "a button (not a value)",
  "BTParameterSpecDerived-736": "a derived parameter",
  "BTParameterSpecForeignId-172": "a foreign id",
  "BTParameterSpecReferencePartStudio-1256": "a reference to another Part Studio",
  "BTParameterSpecReferenceTable-1520": "a table reference",
  "BTParameterSpecReferenceCADImport-1792": "an imported CAD reference",
  "BTParameterSpecReferenceImage-1722": "an image reference",
};

function describeKind(btType: string): string {
  return UNSUPPORTED_LABELS[btType] ?? btType;
}

function asFiniteNumber(value: unknown, parameterId: string): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(n)) {
    throw new Error(`"${parameterId}" needs a number. Got ${JSON.stringify(value)}.`);
  }
  return n;
}

function asIdList(value: unknown, parameterId: string): string[] {
  const raw = Array.isArray(value) ? value : [value];
  const ids = raw.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  if (!ids.length) {
    throw new Error(
      `"${parameterId}" selects geometry, so it needs real deterministic ids — resolve them with ` +
        `onshape_describe or a query first. Vantage never guesses Onshape entity ids.`,
    );
  }
  return ids;
}

function enumOptions(spec: OnshapeParameterSpec): string[] {
  return (spec.options ?? [])
    .map((option) =>
      typeof option === "string"
        ? option
        : String((option as { value?: unknown } | null)?.value ?? "").trim(),
    )
    .filter(Boolean);
}

/**
 * One parameter, from its spec and the value the caller supplied.
 *
 * Millimetres and degrees in — Onshape stores metres and radians, and the
 * human-readable `expression` keeps the original units so the feature reads
 * correctly when a student opens it in Onshape.
 */
export function buildParameterFromSpec(
  spec: OnshapeParameterSpec,
  value: unknown,
): Record<string, unknown> {
  const id = spec.parameterId;

  if (spec.btType === BOOLEAN) {
    if (typeof value !== "boolean") {
      throw new Error(`"${id}" is a checkbox — pass true or false, not ${JSON.stringify(value)}.`);
    }
    return booleanParameter(id, value);
  }

  if (spec.btType === ENUM) {
    const wanted = String(value ?? "").trim();
    const options = enumOptions(spec);
    if (!wanted) throw new Error(`"${id}" needs one of: ${options.join(", ") || "(none published)"}.`);
    // Case-insensitive match, but send Onshape its own spelling.
    const matched = options.find((option) => option.toLowerCase() === wanted.toLowerCase());
    if (options.length && !matched) {
      throw new Error(`"${id}" does not accept ${JSON.stringify(wanted)}. Options: ${options.join(", ")}.`);
    }
    return enumParameter(id, spec.enumName ?? "", matched ?? wanted);
  }

  if (spec.btType === QUERY) {
    return deterministicQueryParameter(id, asIdList(value, id));
  }

  if (spec.btType === QUANTITY) {
    const kind = (spec.quantityType ?? "").toUpperCase();
    const n = asFiniteNumber(value, id);
    if (kind === "LENGTH") {
      // Onshape's internal length unit is metres; the caller speaks mm.
      return quantityParameter(id, n, n / 1000);
    }
    if (kind === "ANGLE") return angleParameter(id, n);
    if (kind === "INTEGER") {
      if (!Number.isInteger(n)) throw new Error(`"${id}" must be a whole number. Got ${n}.`);
      return countParameter(id, n);
    }
    // REAL and ANYTHING carry no unit — a ratio, a scale, a count of turns.
    return {
      btType: "BTMParameterQuantity-147",
      isInteger: false,
      value: n,
      units: "",
      expression: String(n),
      parameterId: id,
    };
  }

  throw new Error(
    `"${id}" is ${describeKind(spec.btType)}, which Vantage does not build generically yet. ` +
      `Set it in Onshape, or use a dedicated tool if one exists.`,
  );
}

/**
 * The full BTM payload for
 *   POST /partstudios/d/{did}/w/{wid}/e/{eid}/features
 *
 * Values the caller omits are simply left out, so Onshape applies the spec's
 * own defaults — which is what the UI does when you accept a dialog without
 * touching every field.
 */
export function buildFeatureFromSpec(input: {
  spec: OnshapeFeatureSpec;
  values: GenericFeatureValues;
  /** Feature name as it appears in the tree. Defaults to Onshape's own. */
  name?: string;
}): { btType: string; feature: Record<string, unknown> } {
  const { spec, values } = input;
  const byId = new Map((spec.parameters ?? []).map((parameter) => [parameter.parameterId, parameter]));

  const unknown = Object.keys(values).filter((key) => !byId.has(key));
  if (unknown.length) {
    const known = [...byId.keys()].sort();
    throw new Error(
      `${spec.featureType} has no parameter ${unknown.map((k) => `"${k}"`).join(", ")}. ` +
        `It accepts: ${known.join(", ")}.`,
    );
  }

  const parameters = Object.entries(values).map(([id, value]) =>
    buildParameterFromSpec(byId.get(id) as OnshapeParameterSpec, value),
  );

  return {
    btType: "BTFeatureDefinitionCall-1406",
    feature: {
      btType: "BTMFeature-134",
      featureType: spec.featureType,
      name: input.name?.trim() || spec.featureTypeName || spec.featureType,
      parameters,
      suppressed: false,
      namespace: "",
    },
  };
}

/**
 * What a caller can actually set on a feature, for showing the agent its
 * options before it commits to a payload.
 */
export function describeFeatureParameters(spec: OnshapeFeatureSpec): Array<{
  parameterId: string;
  name: string;
  kind: string;
  supported: boolean;
  options?: string[];
  units?: string;
}> {
  return (spec.parameters ?? []).map((parameter) => {
    const supported = [QUANTITY, BOOLEAN, QUERY, ENUM].includes(parameter.btType);
    const kindLabel =
      parameter.btType === QUANTITY
        ? `number (${(parameter.quantityType ?? "REAL").toLowerCase()})`
        : parameter.btType === BOOLEAN
          ? "true/false"
          : parameter.btType === ENUM
            ? "one of a list"
            : parameter.btType === QUERY
              ? "geometry selection"
              : describeKind(parameter.btType);
    const units =
      parameter.quantityType === "LENGTH"
        ? "mm"
        : parameter.quantityType === "ANGLE"
          ? "degrees"
          : undefined;
    return {
      parameterId: parameter.parameterId,
      name: parameter.parameterName || parameter.parameterId,
      kind: kindLabel,
      supported,
      ...(parameter.btType === ENUM ? { options: enumOptions(parameter) } : {}),
      ...(units ? { units } : {}),
    };
  });
}
