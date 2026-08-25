/**
 * Printer-specific hole compensation.
 *
 * FDM printers print holes undersized. Bambu Lab's own documentation lists the
 * causes: material shrinkage, elephant's foot from first-layer squish, hole
 * diameters near the nozzle size, and missing lead-in chamfers.
 * https://wiki.bambulab.com/en/software/bambu-studio/xy-hole-contour-compensation
 *
 * That page also establishes the SHAPE of the correction, which this model
 * follows. Shrinkage compensation scales only a part's outer dimensions and
 * explicitly "does not affect the size of internal features (such as holes)";
 * holes get a separate additive offset, and the slicer field for it is a RADIUS
 * value, so "the hole diameter will increase by twice the compensation value".
 * Bambu's own worked example lands on +0.15 mm radial, i.e. +0.30 mm on
 * diameter, which brackets the +0.22 mm this model produces for an M3.
 *
 * THE MODEL. Three terms, added to the nominal diameter:
 *
 *   compensated = nominal + squish + curveApproximation + shrinkage
 *
 * 1. squish  — EMPIRICAL. First-layer elephant foot plus the general tendency of
 *    a perimeter bead to be pressed into the void it borders. Constant with
 *    respect to diameter, proportional to bead width. This is the dominant term
 *    (~84% of the M3 correction) and it is FITTED, not derived: see
 *    `materials.ts` for the arithmetic tying it to the one measured data point.
 *
 * 2. curveApproximation — DERIVED. A slicer walks a circle as straight segments.
 *    Taking a segment length of about one extrusion width, a hole of radius r is
 *    approximated by an n-sided polygon with n = 2*pi*r/W, and the largest circle
 *    that actually fits is the polygon's inscribed circle of radius r*cos(pi/n).
 *    With pi/n = W/(2r) the diameter lost is
 *
 *        2r * (1 - cos(W / (2r)))          (~= W^2 / (2d) for small W/d)
 *
 *    Small next to the squish term (~0.026 mm on an M3) but it scales as 1/d, so
 *    it is what makes a 2 mm hole need proportionally more help than a 12 mm one.
 *
 * 3. shrinkage — DERIVED from the material's linear shrinkage: a hole contracts
 *    with the part around it, losing d * shrinkageFraction. Around 0.010 mm on an
 *    M3 in PLA. The shrinkage figures themselves are typical values rather than
 *    vendor specs; `materials.ts` says so explicitly.
 *
 * CALIBRATION. Only PLA on a 0.4 mm Bambu nozzle is fitted to a measured part.
 * Every other combination reuses that fraction as a starting estimate and
 * reports `calibrated: false` so the caller is told to print a coupon rather
 * than being handed a number that looks authoritative and is not.
 */

import { insertsForThread, requireInsert } from "./inserts";
import { extrusionWidthMm } from "./printers";
import { clearanceHoleMm, tapDrillMm } from "./threads";
import type {
  CompensatedHole,
  HoleFeature,
  MaterialProfile,
  MetricThread,
  PrinterProfile,
} from "./types";

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Diameter lost to walking a circle as straight segments, from the inscribed
 * polygon derived above. Exact trigonometric form, not the small-angle version.
 */
export function curveApproximationOffsetMm(nominalDiameterMm: number, extrusionWidth: number): number {
  if (nominalDiameterMm <= 0) return 0;
  const radius = nominalDiameterMm / 2;
  const halfSegmentAngle = extrusionWidth / (2 * radius);
  // A bead wider than the hole makes the angle meaningless; such a hole cannot
  // be printed at all and the small-feature check fails it separately.
  if (halfSegmentAngle >= Math.PI / 2) return 0;
  return 2 * radius * (1 - Math.cos(halfSegmentAngle));
}

/** Diameter lost as the part contracts around the hole. */
export function shrinkageOffsetMm(nominalDiameterMm: number, shrinkageFraction: number): number {
  return nominalDiameterMm * shrinkageFraction;
}

/** Diameter lost to first-layer squish and perimeter overlap. Empirical. */
export function squishOffsetMm(extrusionWidth: number, fractionOfExtrusionWidth: number): number {
  return extrusionWidth * fractionOfExtrusionWidth;
}

/**
 * The heat-set insert this module assumes when a hole says only "insert" and a
 * thread: the longest body in that size, which is the usual structural choice.
 */
export function defaultInsertIdForThread(thread: MetricThread): string | undefined {
  const candidates = insertsForThread(thread);
  let best: { id: string; lengthMm: number } | undefined;
  for (const candidate of candidates) {
    if (!best || candidate.lengthMm > best.lengthMm) {
      best = { id: candidate.id, lengthMm: candidate.lengthMm };
    }
  }
  return best?.id;
}

/** Resolve the pre-compensation diameter a hole feature is asking for. */
export function nominalHoleDiameterMm(hole: HoleFeature): number {
  if (typeof hole.nominalDiameterMm === "number") {
    if (!(hole.nominalDiameterMm > 0)) {
      throw new Error(`Hole "${hole.id}" has a non-positive nominal diameter.`);
    }
    return hole.nominalDiameterMm;
  }
  const thread = hole.thread;
  if (!thread) {
    throw new Error(`Hole "${hole.id}" needs either a thread designation or an explicit nominalDiameterMm.`);
  }
  switch (hole.kind) {
    case "clearance":
      return clearanceHoleMm(thread, hole.fit ?? "normal");
    case "tap":
      return tapDrillMm(thread);
    case "insert": {
      const insertId = defaultInsertIdForThread(thread);
      if (!insertId) {
        throw new Error(`No heat-set insert is tabulated for ${thread}; give hole "${hole.id}" an explicit nominalDiameterMm.`);
      }
      return requireInsert(insertId).boreDiameterMm;
    }
    case "plain":
      throw new Error(`Plain hole "${hole.id}" needs an explicit nominalDiameterMm.`);
    default:
      throw new Error(`Hole "${hole.id}" has an unrecognised kind.`);
  }
}

export type DiameterCompensation = {
  nominalDiameterMm: number;
  compensatedDiameterMm: number;
  totalOffsetMm: number;
  terms: { squishMm: number; curveApproximationMm: number; shrinkageMm: number };
  slicerRadialEquivalentMm: number;
  calibrated: boolean;
};

/**
 * True only where the empirical squish fraction was fitted to a measured part:
 * PLA, on a Bambu machine, with the 0.4 mm nozzle the measurement was taken on.
 */
export function compensationIsCalibrated(printer: PrinterProfile, material: MaterialProfile): boolean {
  return (
    material.holeCompensationCalibrated &&
    printer.brand === "Bambu Lab" &&
    Math.abs(printer.nozzleDiameterMm - 0.4) < 1e-9
  );
}

/** Diameter to model in CAD so the printed hole lands on `nominalDiameterMm`. */
export function compensateHoleDiameter(
  nominalDiameterMm: number,
  printer: PrinterProfile,
  material: MaterialProfile,
): DiameterCompensation {
  const width = extrusionWidthMm(printer.nozzleDiameterMm);
  const squishMm = squishOffsetMm(width, material.holeSquishFractionOfExtrusionWidth);
  const curveApproximationMm = curveApproximationOffsetMm(nominalDiameterMm, width);
  const shrinkageMm = shrinkageOffsetMm(nominalDiameterMm, material.shrinkageFraction);
  const totalOffsetMm = squishMm + curveApproximationMm + shrinkageMm;
  const compensatedDiameterMm = nominalDiameterMm + totalOffsetMm;
  return {
    nominalDiameterMm,
    compensatedDiameterMm: round(compensatedDiameterMm, 2),
    totalOffsetMm: round(totalOffsetMm, 3),
    terms: {
      squishMm: round(squishMm, 3),
      curveApproximationMm: round(curveApproximationMm, 3),
      shrinkageMm: round(shrinkageMm, 3),
    },
    // The slicer field is a radius, so half the diameter correction.
    slicerRadialEquivalentMm: round(totalOffsetMm / 2, 3),
    calibrated: compensationIsCalibrated(printer, material),
  };
}

export function compensateHoleFeature(
  hole: HoleFeature,
  printer: PrinterProfile,
  material: MaterialProfile,
): CompensatedHole {
  const nominal = nominalHoleDiameterMm(hole);
  const compensation = compensateHoleDiameter(nominal, printer, material);
  return {
    featureId: hole.id,
    kind: hole.kind,
    thread: hole.thread ?? null,
    nominalDiameterMm: compensation.nominalDiameterMm,
    compensatedDiameterMm: compensation.compensatedDiameterMm,
    totalOffsetMm: compensation.totalOffsetMm,
    terms: compensation.terms,
    slicerRadialEquivalentMm: compensation.slicerRadialEquivalentMm,
    calibrated: compensation.calibrated,
  };
}
