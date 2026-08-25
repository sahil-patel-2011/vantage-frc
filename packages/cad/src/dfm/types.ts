/**
 * Shared types for the local design-for-manufacturing (DFM) pass.
 *
 * Everything in `src/dfm` runs offline: no Onshape call, no network access, no
 * credentials. It exists so a part is checked and print-compensated *before* any
 * session/API-key call is spent building it.
 */

export type Severity = "pass" | "warn" | "fail";

/** Stable ids so a caller can filter or suppress a specific rule. */
export type CheckId =
  | "bed-fit"
  | "min-wall"
  | "hole-to-edge"
  | "insert-depth"
  | "insert-boss-wall"
  | "overhang"
  | "small-feature"
  | "nozzle-abrasion"
  | "chamber-requirement"
  | "bed-temperature"
  | "hole-compensation-calibration";

export type CheckFinding = {
  check: CheckId;
  severity: Severity;
  /** The offending feature id, or the part name for whole-part rules. */
  feature: string;
  /** What the part currently is, in mm/degrees. Null when the rule is not dimensional. */
  measured: number | null;
  /** What the rule demands, in the same unit as `measured`. */
  required: number | null;
  unit: "mm" | "deg" | "C" | null;
  message: string;
  /** A concrete change the designer can make. Never "fix the violation". */
  fix: string;
};

export type Vec3 = { x: number; y: number; z: number };

// ---------------------------------------------------------------------------
// Printer + material profiles
// ---------------------------------------------------------------------------

export type MultiMaterialKind =
  /** One nozzle, no automatic material change. */
  | "none"
  /** One nozzle fed by an automatic material system; colours swap by purging. */
  | "ams-single-nozzle"
  /** Two independent fixed hotends. */
  | "dual-nozzle"
  /** Independent toolheads parked in a dock and swapped mid-print. */
  | "toolchanger";

export type NozzleMaterial = "stainless-steel" | "hardened-steel";

export type ChamberSpec = {
  /** True only when the manufacturer states the chamber is actively *heated*. */
  activeHeating: boolean;
  /** Manufacturer max chamber temperature, or null when none is published. */
  maxC: number | null;
  /** A closed box (passive) still helps ABS/ASA even without active heating. */
  enclosed: boolean;
};

export type PrinterProfile = {
  id: string;
  brand: string;
  model: string;
  /**
   * Manufacturer build volume in mm. For a multi-nozzle machine this is the
   * envelope available to a single part printed with one nozzle, which is the
   * envelope a bed-fit check actually cares about.
   */
  buildVolumeMm: Vec3;
  /**
   * Z the vendor's own slicer allows by default, when that is lower than the
   * advertised build volume. Null when it matches `buildVolumeMm.z`.
   */
  defaultMaxZMm: number | null;
  nozzleDiameterMm: number;
  supportedNozzleDiametersMm: readonly number[];
  nozzleMaterial: NozzleMaterial;
  maxNozzleC: number;
  maxBedC: number;
  chamber: ChamberSpec;
  toolheads: number;
  multiMaterial: MultiMaterialKind;
  /**
   * False when any field above could not be confirmed against the
   * manufacturer's published specification. A false here is surfaced in the
   * report rather than silently trusted.
   */
  specVerified: boolean;
  /** Manufacturer URLs backing the numbers above. */
  sources: readonly string[];
  notes: readonly string[];
};

export type MaterialProfile = {
  id: string;
  name: string;
  /**
   * Linear shrinkage as a fraction (0.003 = 0.3%). See `materials.ts`: these are
   * typical starting values, NOT manufacturer-published figures.
   */
  shrinkageFraction: number;
  /** False whenever `shrinkageFraction` is a typical value rather than a vendor spec. */
  shrinkageVerified: boolean;
  /** A closed box is needed to avoid warping/delamination. */
  requiresEnclosure: boolean;
  /** An *actively heated* chamber materially improves results (never merely "enclosed"). */
  prefersActiveChamber: boolean;
  /** Fibre-filled or otherwise abrasive: needs a hardened nozzle. */
  abrasive: boolean;
  typicalBedC: number;
  typicalNozzleC: number;
  /**
   * Empirical share of one extrusion width lost from a hole's diameter to
   * first-layer squish and perimeter overlap. See `hole-compensation.ts`.
   */
  holeSquishFractionOfExtrusionWidth: number;
  /**
   * True only where that fraction was fitted to a real measured part. Every
   * other material inherits the PLA fit as a starting estimate and says so.
   */
  holeCompensationCalibrated: boolean;
  notes: readonly string[];
  sources: readonly string[];
};

// ---------------------------------------------------------------------------
// Part definition — what the caller describes before anything is modelled
// ---------------------------------------------------------------------------

export type MetricThread = "M2" | "M2.5" | "M3" | "M4" | "M5" | "M6" | "M8";

/** ISO 273 fit series. "normal" is the general-purpose default (M3 -> 3.4 mm). */
export type ClearanceFit = "close" | "normal" | "loose";

export type HoleKind =
  /** A bolt passes through: ISO 273 clearance diameter. */
  | "clearance"
  /** Cut or formed thread: tap-drill diameter. */
  | "tap"
  /** Bore that receives a heat-set insert. */
  | "insert"
  /** Caller supplies the diameter outright. */
  | "plain";

export type HoleFeature = {
  id: string;
  kind: HoleKind;
  /** Supplies the nominal diameter for clearance/tap/insert holes. */
  thread?: MetricThread;
  /** Required when `thread` is absent, or to override the table. */
  nominalDiameterMm?: number;
  /** Clearance series. Defaults to "normal". */
  fit?: ClearanceFit;
  /** Hole CENTRE to the nearest free edge of the part. */
  centerToEdgeMm?: number;
  depthMm?: number;
  through?: boolean;
};

export type InsertFeature = {
  id: string;
  /** Key into the heat-set insert table, e.g. "M3x5.7". */
  insert: string;
  /** Depth of the bore as modelled. */
  boreDepthMm: number;
  /** Radial material from the bore wall to the nearest free surface. */
  bossWallMm: number;
};

export type WallFeature = {
  id: string;
  thicknessMm: number;
};

export type OverhangFeature = {
  id: string;
  /** 0 = vertical wall, 90 = horizontal roof. The 45 deg rule applies to this angle. */
  angleFromVerticalDeg: number;
  spanMm?: number;
};

export type SmallFeature = {
  id: string;
  /** Smallest in-plane dimension of a rib, pin, or embossed detail. */
  minDimensionMm: number;
  kind?: "rib" | "pin" | "emboss" | "engrave" | "other";
};

export type PartDefinition = {
  name: string;
  /** Overall bounding box as modelled, before any print compensation. */
  boundingBoxMm: Vec3;
  walls?: readonly WallFeature[];
  holes?: readonly HoleFeature[];
  inserts?: readonly InsertFeature[];
  overhangs?: readonly OverhangFeature[];
  smallFeatures?: readonly SmallFeature[];
};

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export type BedFitResult = {
  fits: boolean;
  fitsAsModelled: boolean;
  fitsRotated90: boolean;
  /**
   * Smallest Z-rotation in degrees that lets the footprint fit, or null when no
   * rotation does. 0 means it already fits as modelled. A long thin part can fit
   * diagonally on a bed too small for it axis-aligned.
   */
  fittingRotationDeg: number | null;
  envelopeMm: Vec3;
  footprintMm: { x: number; y: number };
  heightMm: number;
};

export type CompensatedHole = {
  featureId: string;
  kind: HoleKind;
  thread: MetricThread | null;
  nominalDiameterMm: number;
  /** Model THIS diameter in CAD so the printed hole lands on nominal. */
  compensatedDiameterMm: number;
  totalOffsetMm: number;
  terms: {
    squishMm: number;
    curveApproximationMm: number;
    shrinkageMm: number;
  };
  /**
   * Equivalent value for a slicer's radial "XY hole compensation" field, for a
   * caller who would rather compensate at slice time than in the model.
   */
  slicerRadialEquivalentMm: number;
  calibrated: boolean;
};

export type DfmReport = {
  part: string;
  printerId: string;
  materialId: string;
  nozzleDiameterMm: number;
  extrusionWidthMm: number;
  /** Worst severity across every finding. */
  status: Severity;
  findings: readonly CheckFinding[];
  bedFit: BedFitResult;
  /** The dimensions to actually model, once compensation is applied. */
  compensatedHoles: readonly CompensatedHole[];
  compensatedInsertBores: readonly {
    featureId: string;
    insert: string;
    nominalBoreMm: number;
    compensatedBoreMm: number;
    requiredDepthMm: number;
  }[];
  /** True when a profile in play is not fully manufacturer-verified. */
  usesUnverifiedProfile: boolean;
};
