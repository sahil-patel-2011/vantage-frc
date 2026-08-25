/**
 * Structured part definition for the one-feature FeatureScript generator.
 *
 * The whole point of this schema is that a plate with four counterbored M3 holes
 * and filleted corners is ONE Onshape feature, not a dozen REST mutations. Every
 * dimension here becomes a named FeatureScript precondition parameter, so a later
 * "make it 8 mm instead of 6" edits a parameter value on the existing feature
 * instead of regenerating and re-inserting geometry.
 *
 * Coordinate convention for every generated part:
 *   - X/Y is the base footprint, the part origin is the CENTRE of that footprint.
 *   - +Z is up. The base sits on Z = 0, so the top face is at Z = <thickness>.
 * Hole centres, pocket centres, rib endpoints and boss centres are all expressed
 * in that frame, in millimetres.
 *
 * Nothing in this file talks to the network. Diameters arriving here are the
 * MODELLED diameters — printer compensation happens upstream in the DFM checks;
 * this generator never silently adjusts a number the caller gave it.
 */

/**
 * `validateCadPlan` in packages/cad/src/index.ts rejects a `feature_script`
 * action whose `source` exceeds 20,000 characters. The generator enforces the
 * same ceiling before anything is sent so the failure names the part feature
 * that blew the budget instead of surfacing as a plan-validation error.
 */
export const FEATURESCRIPT_SOURCE_LIMIT = 20_000;

// ---------------------------------------------------------------------------
// Base shapes
// ---------------------------------------------------------------------------

/** Flat plate: the FRC bread-and-butter part. Footprint centred on the origin. */
export type PlateBase = {
  kind: "plate";
  widthMm: number;
  depthMm: number;
  thicknessMm: number;
};

/**
 * Rectangular box. `wallMm` + `floorMm` hollow it out; omit both for a solid
 * block. `openTop` leaves the +Z face open (the usual printed enclosure).
 */
export type BoxBase = {
  kind: "box";
  widthMm: number;
  depthMm: number;
  heightMm: number;
  wallMm?: number;
  floorMm?: number;
  openTop?: boolean;
};

/**
 * L bracket: a horizontal leg lying in XY from Y = 0 to Y = legAMm, and a
 * vertical leg rising in Z from Z = 0 to Z = legBMm at the Y = 0 edge. Both legs
 * are `thicknessMm` thick and `widthMm` wide in X (centred on X = 0).
 */
export type BracketBase = {
  kind: "bracket";
  widthMm: number;
  legAMm: number;
  legBMm: number;
  thicknessMm: number;
};

export type PartBase = PlateBase | BoxBase | BracketBase;

// ---------------------------------------------------------------------------
// Hole patterns
// ---------------------------------------------------------------------------

export type Point2Mm = { xMm: number; yMm: number };

/** Rectangular grid centred on the part origin. */
export type GridPattern = {
  kind: "grid";
  countX: number;
  countY: number;
  pitchXMm: number;
  pitchYMm: number;
};

/**
 * The four footprint corners, inset from each edge. Requires a base with a
 * width/depth footprint (plate or box) — a bracket has no four-corner face.
 */
export type CornersPattern = {
  kind: "corners";
  insetXMm: number;
  insetYMm: number;
};

/** Evenly stepped row: point i sits at start + i * step. */
export type LinearPattern = {
  kind: "linear";
  count: number;
  startXMm: number;
  startYMm: number;
  stepXMm: number;
  stepYMm: number;
};

/** Bolt circle. Angles are measured from +X toward +Y. */
export type CircularPattern = {
  kind: "circular";
  count: number;
  centerXMm: number;
  centerYMm: number;
  boltCircleDiameterMm: number;
  startAngleDeg?: number;
};

/**
 * Literal point list. These coordinates are baked into the FeatureScript source
 * as constants, so they are the one input a parameter edit CANNOT change — the
 * generator marks them frozen and `planParameterEdit` reports rebuild-required.
 */
export type ExplicitPattern = {
  kind: "explicit";
  points: Point2Mm[];
};

export type HolePattern = GridPattern | CornersPattern | LinearPattern | CircularPattern | ExplicitPattern;

export type CounterboreSpec = {
  diameterMm: number;
  depthMm: number;
};

export type HoleSpec = {
  /** Stable token; becomes the FeatureScript sub-id prefix and parameter prefix. */
  id: string;
  /** Modelled diameter in mm. Printer compensation is applied by the DFM pass, not here. */
  diameterMm: number;
  /** THROUGH by default. A blind hole is drilled down from the top face. */
  through?: boolean;
  /** Required when `through` is false. */
  depthMm?: number;
  counterbore?: CounterboreSpec;
  pattern: HolePattern;
};

// ---------------------------------------------------------------------------
// Other features
// ---------------------------------------------------------------------------

/** Rectangular pocket cut down from the top face. */
export type PocketSpec = {
  id: string;
  centerXMm: number;
  centerYMm: number;
  widthMm: number;
  depthMm: number;
  /** How far down from the top face the pocket is cut. */
  cutDepthMm: number;
  /** Optional vertical corner radius so the pocket prints without stress risers. */
  cornerRadiusMm?: number;
};

/**
 * Axis-aligned stiffening rib standing on the top face. Diagonal ribs are
 * rejected rather than approximated — either fromXMm === toXMm or
 * fromYMm === toYMm.
 */
export type RibSpec = {
  id: string;
  fromXMm: number;
  fromYMm: number;
  toXMm: number;
  toYMm: number;
  thicknessMm: number;
  heightMm: number;
};

/**
 * Heat-set insert boss: a cylinder added on the top face with an insert bore
 * drilled into it. `insertDiameterMm` / `insertDepthMm` come from the DFM insert
 * table — this generator does not know any insert dimensions and never guesses one.
 */
export type BossSpec = {
  id: string;
  centerXMm: number;
  centerYMm: number;
  outerDiameterMm: number;
  heightMm: number;
  insertDiameterMm: number;
  insertDepthMm: number;
};

/**
 * `corners` selects the vertical (Z-parallel) straight edges of the part — the
 * plate corners. `all` selects every edge of the resulting body. Only these two
 * selections are generated: they are the ones whose FeatureScript query the
 * generator can build from documented std-library calls without guessing.
 */
export type EdgeTreatmentSelection = "corners" | "all";

export type EdgeTreatmentSpec = {
  id: string;
  kind: "fillet" | "chamfer";
  selection: EdgeTreatmentSelection;
  sizeMm: number;
};

// ---------------------------------------------------------------------------
// The part
// ---------------------------------------------------------------------------

export type PartDefinition = {
  /** Human name; becomes the Onshape "Feature Type Name" and the feature's label. */
  name: string;
  base: PartBase;
  holes?: HoleSpec[];
  pockets?: PocketSpec[];
  ribs?: RibSpec[];
  bosses?: BossSpec[];
  edges?: EdgeTreatmentSpec[];
};

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

export type FeatureScriptParameterKind = "length" | "count" | "angle";

export type FeatureScriptParameter = {
  /** FeatureScript `definition.<parameterId>` key AND the BTM `parameterId`. */
  parameterId: string;
  /** Annotation "Name" shown in the Onshape feature dialog. */
  label: string;
  kind: FeatureScriptParameterKind;
  /** mm for `length`, degrees for `angle`, a whole number for `count`. */
  value: number;
  /** Onshape expression string, e.g. "6 mm", "30 deg", "4". */
  expression: string;
  /** Dotted path back into the PartDefinition, so a parameter edit stays in sync locally. */
  path: string;
  /** Inclusive edit bounds. Outside these the generator reports rebuild-required. */
  minimum: number;
  maximum: number;
};

/** Where the FeatureScript source cost went, for the 20k budget message. */
export type SourceBudgetSection = {
  label: string;
  characters: number;
};

// ---------------------------------------------------------------------------
// Helpers shared by the generator
// ---------------------------------------------------------------------------

/** Turn a caller token ("m3-corner", "M3 corner") into a FeatureScript identifier stem. */
export function featureScriptToken(raw: string, label: string): string {
  const parts = String(raw ?? "")
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (!parts.length) {
    throw new Error(`${label} must contain at least one letter or digit. Got "${String(raw)}".`);
  }
  const head = parts[0]!;
  const rest = parts.slice(1).map((part) => part[0]!.toUpperCase() + part.slice(1));
  let token = [head, ...rest].join("");
  // FeatureScript identifiers cannot start with a digit.
  if (/^[0-9]/.test(token)) token = `p${token}`;
  token = token[0]!.toLowerCase() + token.slice(1);
  if (token.length > 40) {
    throw new Error(`${label} "${String(raw)}" is too long — keep ids to 40 characters or fewer.`);
  }
  return token;
}

/** Positive millimetre dimension. */
export function positiveMm(value: unknown, label: string, max = 10_000): number {
  const mm = Number(value);
  if (!Number.isFinite(mm) || mm <= 0 || mm > max) {
    throw new Error(`${label} must be a positive number of millimetres (max ${max}). Got ${String(value)}.`);
  }
  return mm;
}

/** Signed millimetre coordinate. */
export function coordinateMm(value: unknown, label: string, max = 10_000): number {
  const mm = Number(value);
  if (!Number.isFinite(mm) || Math.abs(mm) > max) {
    throw new Error(`${label} must be a number of millimetres between -${max} and ${max}. Got ${String(value)}.`);
  }
  return mm;
}

export function wholeCount(value: unknown, label: string, min = 1, max = 400): number {
  const count = Number(value);
  if (!Number.isInteger(count) || count < min || count > max) {
    throw new Error(`${label} must be a whole number between ${min} and ${max}. Got ${String(value)}.`);
  }
  return count;
}

/**
 * FeatureScript number literal. Fixed notation only — FeatureScript has no
 * `1e-3` literal, so `toExponential` output would be a syntax error in Onshape.
 */
export function fsNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Cannot emit a non-finite number into FeatureScript: ${String(value)}.`);
  const rounded = Number(value.toFixed(6));
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/** `12.5 * millimeter` — the units are explicit so the feature reads correctly in Onshape. */
export function fsMillimetres(value: number): string {
  // A negative literal is emitted as `-0.5 * millimeter`, which parses as
  // (-0.5) * millimeter; wrapping it would only add noise for a student reading
  // the generated Feature Studio.
  return `${fsNumber(value)} * millimeter`;
}

export function expressionFor(kind: FeatureScriptParameterKind, value: number): string {
  if (kind === "length") return `${fsNumber(value)} mm`;
  if (kind === "angle") return `${fsNumber(value)} deg`;
  return String(Math.round(value));
}

// ---------------------------------------------------------------------------
// Applying a parameter edit back onto the local definition
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Set one numeric leaf identified by a `FeatureScriptParameter.path`
 * ("base.thicknessMm", "holes.0.pattern.pitchXMm"). Only numeric leaves that
 * already exist can be written — a path that does not resolve is a generator bug
 * or a caller-supplied path, and either way must not silently create a field.
 */
export function setDefinitionPath(definition: PartDefinition, path: string, value: number): void {
  const segments = path.split(".").filter(Boolean);
  if (segments.length < 2) throw new Error(`"${path}" is not a valid part-definition path.`);
  let cursor: unknown = definition;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) {
        throw new Error(`"${path}" does not resolve — index ${segment} is out of range.`);
      }
      cursor = cursor[index];
      continue;
    }
    if (!isRecord(cursor) || !(segment in cursor)) {
      throw new Error(`"${path}" does not resolve on this part definition.`);
    }
    cursor = cursor[segment];
  }
  const leaf = segments[segments.length - 1]!;
  if (!isRecord(cursor) || typeof cursor[leaf] !== "number") {
    throw new Error(`"${path}" does not point at a number on this part definition.`);
  }
  cursor[leaf] = value;
}

/** Structured clone that keeps the definition plain-JSON, which it always is. */
export function clonePartDefinition(definition: PartDefinition): PartDefinition {
  return JSON.parse(JSON.stringify(definition)) as PartDefinition;
}
