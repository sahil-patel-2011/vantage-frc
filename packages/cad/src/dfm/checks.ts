/**
 * The DFM rules themselves. One exported function per rule so a caller — or a
 * test — can run a single rule without assembling a whole report.
 *
 * EVERY THRESHOLD HERE CARRIES ITS SOURCE. A fabricated wall rule or overhang
 * limit costs a team a failed print and a night of filament, so a number with no
 * citation next to it does not belong in this file. Where a rule had to be
 * carried over from a neighbouring process rather than an FDM-specific
 * publication, the comment says so in as many words.
 *
 * Rules that are pure geometry against a manufacturer specification (does the
 * part fit the bed, is the nozzle hard enough for this filament) cite the
 * printer/material profile instead, which carries its own vendor URL.
 */

import { requiredBossWallMm, requiredBoreDepthMm, type HeatSetInsert } from "./inserts";
import { extrusionWidthMm, usableHeightMm } from "./printers";
import type { UnresolvedBoss } from "./derive";
import type {
  BedFitResult,
  CheckFinding,
  HoleFeature,
  InsertFeature,
  MaterialProfile,
  OverhangFeature,
  PartDefinition,
  PrinterProfile,
  Severity,
  SmallFeature,
  WallFeature,
} from "./types";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * Below one bead there is nothing for the slicer to lay down.
 * Prusa, verbatim: walls "thinner than one nozzle perimeter are not printable."
 * https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135
 */
export const MIN_WALL_PERIMETERS = 1;

/**
 * Two perimeters is the floor for a wall that has to carry anything.
 * Prusa: "Original Prusa profiles always use a minimum of two perimeters", and
 * "The strength of a model is mostly defined by the number of perimeters (not
 * the infill)."
 * https://help.prusa3d.com/article/layers-and-perimeters_1748
 * Protolabs Network's FDM table reaches the same number from the other side:
 * minimum wall thickness 0.8 mm supported and free, which is two 0.4 mm beads.
 * https://www.hubs.com/knowledge-base/dfm-tips-for-3d-printed-parts-with-thin-walls/
 */
export const RECOMMENDED_WALL_PERIMETERS = 2;

/**
 * Protolabs Network: "an overhang can usually be printed up to 45 degrees
 * without compromising quality."
 * https://www.hubs.com/knowledge-base/how-design-parts-fdm-3d-printing/
 */
export const OVERHANG_CLEAN_DEG = 45;

/**
 * Prusa: "A 3D printer can cleanly print overhanging structures with an angle
 * between 45 and 60 degrees." Past 60 the part needs support.
 * https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135
 *
 * The same page notes a Nextruder machine with 360-degree cooling reaches 75
 * degrees. That is a per-machine capability `PrinterProfile` does not record, so
 * the general 60 is used for every printer rather than inventing a field.
 */
export const OVERHANG_SUPPORT_DEG = 60;

/**
 * Strength guideline for material left between a hole and a free edge.
 *
 * CARRIED OVER FROM INJECTION MOULDING — this is not an FDM-specific published
 * figure, and it is marked as such in the finding it produces. Source, verbatim:
 * "The distance between the hole and the edge of the product is preferably
 * greater than 1.5 times the hole diameter."
 * https://www.jpmcnc.com/plastic-injection-molded-parts.html
 *
 * That source does not say whether the distance is measured from the hole centre
 * or from its wall. 1.5 x D from the CENTRE is used here: it is the standard
 * fastener edge-distance convention and it is the less demanding of the two
 * readings, so the rule does not over-report on the strength of one ambiguity.
 */
export const HOLE_EDGE_DIAMETER_MULTIPLE = 1.5;

/**
 * SPIROL, verbatim: "the optimum wall thickness or boss diameter of the plastic
 * is two (2) to three (3) times the Insert diameter".
 * https://www.spirol.com/resources/white-papers/how-to-design-the-proper-hole-for-heat-ultrasonic-inserts/
 *
 * `requiredBossWallMm` in `inserts.ts` is the 2x lower bound (below it, fail).
 * This is the 3x optimum (below it but above 2x, warn).
 */
export const BOSS_DIAMETER_OPTIMUM_MULTIPLE = 3;

/**
 * Step of the bed-fit rotation search, in degrees.
 *
 * NOT a manufacturing figure. A part is placed on a plate by hand or by a
 * slicer's auto-arrange; an orientation window narrower than this cannot be hit
 * in practice, so failing to find one is the conservative answer.
 */
export const ROTATION_SEARCH_STEP_DEG = 0.05;

/** Absorbs floating-point noise on an exactly-flush fit. Not a clearance allowance. */
const FIT_EPSILON_MM = 1e-9;

/**
 * Absorbs floating-point noise when a dimension worked out by arithmetic meets a
 * threshold that was rounded for display. A boss wall of (9.2 - 4.0) / 2 is
 * 2.5999999999999996 in binary floating point and must not read as thinner than
 * the 2.6 mm the rule asks for. NOT a manufacturing tolerance — it is six orders
 * of magnitude below anything a printer can resolve.
 */
const COMPARE_EPSILON_MM = 1e-6;

/** `value` is meaningfully below `threshold`, ignoring floating-point noise. */
function below(value: number, threshold: number): boolean {
  return value < threshold - COMPARE_EPSILON_MM;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mm(value: number): string {
  return `${round(value, 2)} mm`;
}

/** Worst severity in a list. An empty list is a pass. */
export function worstSeverity(findings: readonly CheckFinding[]): Severity {
  let worst: Severity = "pass";
  for (const finding of findings) {
    if (finding.severity === "fail") return "fail";
    if (finding.severity === "warn") worst = "warn";
  }
  return worst;
}

/** Thinnest wall this nozzle can lay at all. */
export function minimumWallMm(printer: PrinterProfile): number {
  return MIN_WALL_PERIMETERS * extrusionWidthMm(printer.nozzleDiameterMm);
}

/** Thinnest wall that still gets the two perimeters a load path needs. */
export function recommendedWallMm(printer: PrinterProfile): number {
  return RECOMMENDED_WALL_PERIMETERS * extrusionWidthMm(printer.nozzleDiameterMm);
}

/** SPIROL's 3x boss-diameter optimum, expressed as radial material from the bore wall. */
export function optimumBossWallMm(insert: HeatSetInsert): number {
  return round((BOSS_DIAMETER_OPTIMUM_MULTIPLE * insert.outerDiameterMm - insert.boreDiameterMm) / 2, 2);
}

// ---------------------------------------------------------------------------
// Bed fit
// ---------------------------------------------------------------------------

/**
 * A rectangle rotated by theta about Z occupies an axis-aligned box of
 * w|cos| + d|sin| by w|sin| + d|cos|. That box is the SMALLEST axis-aligned box
 * containing the rotated rectangle, and the bed is axis-aligned, so the
 * rectangle fits the bed at that rotation exactly when the box does.
 */
export function footprintFitsAtDeg(
  angleDeg: number,
  footprintXMm: number,
  footprintYMm: number,
  bedXMm: number,
  bedYMm: number,
): boolean {
  const radians = (angleDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return (
    footprintXMm * cos + footprintYMm * sin <= bedXMm + FIT_EPSILON_MM &&
    footprintXMm * sin + footprintYMm * cos <= bedYMm + FIT_EPSILON_MM
  );
}

/**
 * Smallest Z-rotation that lets the footprint fit, or null when none does.
 *
 * Rotating by 90 degrees swaps the two extents, and the pair (width, height) at
 * theta + 90 is the pair at theta reversed, so a sweep of 0..90 covers every
 * distinct orientation. 0 and 90 are tested exactly rather than through the
 * trigonometry so a flush fit is not lost to a 6e-17 cosine.
 */
export function smallestFittingRotationDeg(
  footprintXMm: number,
  footprintYMm: number,
  bedXMm: number,
  bedYMm: number,
): number | null {
  if (footprintXMm <= bedXMm + FIT_EPSILON_MM && footprintYMm <= bedYMm + FIT_EPSILON_MM) return 0;
  for (let angle = ROTATION_SEARCH_STEP_DEG; angle < 90; angle += ROTATION_SEARCH_STEP_DEG) {
    if (footprintFitsAtDeg(angle, footprintXMm, footprintYMm, bedXMm, bedYMm)) return round(angle, 2);
  }
  if (footprintYMm <= bedXMm + FIT_EPSILON_MM && footprintXMm <= bedYMm + FIT_EPSILON_MM) return 90;
  return null;
}

/**
 * Does the part fit the machine, and does turning it help?
 *
 * Only Z-rotations are considered. Laying a part on its side changes which faces
 * are overhangs and which way the layer lines run, so it is a design decision
 * this check must not make silently.
 */
export function bedFit(description: PartDefinition, printer: PrinterProfile): BedFitResult {
  const envelopeMm = {
    x: printer.buildVolumeMm.x,
    y: printer.buildVolumeMm.y,
    z: usableHeightMm(printer),
  };
  const footprintMm = { x: description.boundingBoxMm.x, y: description.boundingBoxMm.y };
  const heightMm = description.boundingBoxMm.z;
  const heightFits = heightMm <= envelopeMm.z + FIT_EPSILON_MM;

  const fittingRotationDeg = smallestFittingRotationDeg(
    footprintMm.x,
    footprintMm.y,
    envelopeMm.x,
    envelopeMm.y,
  );
  const fitsAsModelled =
    heightFits && footprintFitsAtDeg(0, footprintMm.x, footprintMm.y, envelopeMm.x, envelopeMm.y);
  const fitsRotated90 =
    heightFits && footprintMm.y <= envelopeMm.x + FIT_EPSILON_MM && footprintMm.x <= envelopeMm.y + FIT_EPSILON_MM;

  return {
    fits: heightFits && fittingRotationDeg !== null,
    fitsAsModelled,
    fitsRotated90,
    fittingRotationDeg,
    envelopeMm,
    footprintMm,
    heightMm,
  };
}

export function checkBedFit(
  description: PartDefinition,
  printer: PrinterProfile,
  fit: BedFitResult,
): CheckFinding {
  const envelope = `${fit.envelopeMm.x} x ${fit.envelopeMm.y} x ${fit.envelopeMm.z} mm`;
  const size = `${mm(fit.footprintMm.x)} x ${mm(fit.footprintMm.y)} x ${mm(fit.heightMm)}`;
  const heightNote =
    printer.defaultMaxZMm !== null
      ? ` (Z is capped at ${printer.defaultMaxZMm} mm by the vendor slicer default, not the ${printer.buildVolumeMm.z} mm advertised volume.)`
      : "";

  if (fit.heightMm > fit.envelopeMm.z + FIT_EPSILON_MM) {
    return {
      check: "bed-fit",
      severity: "fail",
      feature: description.name,
      measured: round(fit.heightMm, 2),
      required: fit.envelopeMm.z,
      unit: "mm",
      message: `${description.name} is ${mm(fit.heightMm)} tall; the ${printer.brand} ${printer.model} envelope is ${envelope}.${heightNote}`,
      fix: `Split the part at or below ${fit.envelopeMm.z} mm and join the halves, or move it to a taller machine. A Z-rotation cannot help with height.`,
    };
  }

  if (!fit.fits) {
    const worstAxis = fit.footprintMm.x / fit.envelopeMm.x >= fit.footprintMm.y / fit.envelopeMm.y ? "X" : "Y";
    const over = Math.max(fit.footprintMm.x - fit.envelopeMm.x, fit.footprintMm.y - fit.envelopeMm.y);
    return {
      check: "bed-fit",
      severity: "fail",
      feature: description.name,
      measured: round(Math.max(fit.footprintMm.x, fit.footprintMm.y), 2),
      required: Math.min(fit.envelopeMm.x, fit.envelopeMm.y),
      unit: "mm",
      message: `${size} does not fit the ${printer.brand} ${printer.model} (${envelope}) at any Z-rotation — the ${worstAxis} footprint is over by ${mm(Math.max(over, 0))}.`,
      fix: `Shorten the footprint to ${fit.envelopeMm.x} x ${fit.envelopeMm.y} mm, or split the part and bolt the sections together.`,
    };
  }

  if (!fit.fitsAsModelled) {
    // A quarter turn is what a person actually does on a build plate, so that is
    // what the fix says whenever it works — even where some slightly smaller
    // angle also fits, which `fittingRotationDeg` still records.
    const rotation = fit.fitsRotated90 ? 90 : (fit.fittingRotationDeg ?? 0);
    const how =
      rotation === 90
        ? "turning it 90 degrees on the plate"
        : `turning it ${rotation} degrees on the plate — it fits diagonally, not square to the axes`;
    return {
      check: "bed-fit",
      severity: "warn",
      feature: description.name,
      measured: round(Math.max(fit.footprintMm.x, fit.footprintMm.y), 2),
      required: Math.max(fit.envelopeMm.x, fit.envelopeMm.y),
      unit: "mm",
      message: `${size} does not fit the ${printer.brand} ${printer.model} (${envelope}) as modelled, but it does after ${how}.`,
      fix: `Rotate the part ${rotation} degrees about Z on the build plate before slicing. Nothing about the model has to change.`,
    };
  }

  return {
    check: "bed-fit",
    severity: "pass",
    feature: description.name,
    measured: round(Math.max(fit.footprintMm.x, fit.footprintMm.y), 2),
    required: Math.min(fit.envelopeMm.x, fit.envelopeMm.y),
    unit: "mm",
    message: `${size} fits the ${printer.brand} ${printer.model} envelope (${envelope}) as modelled.${heightNote}`,
    fix: "No change needed.",
  };
}

// ---------------------------------------------------------------------------
// Minimum wall
// ---------------------------------------------------------------------------

export function checkWalls(walls: readonly WallFeature[], printer: PrinterProfile): CheckFinding[] {
  if (!walls.length) return [];
  const width = extrusionWidthMm(printer.nozzleDiameterMm);
  const floor = minimumWallMm(printer);
  const recommended = recommendedWallMm(printer);
  const findings: CheckFinding[] = [];

  for (const wall of walls) {
    if (below(wall.thicknessMm, floor)) {
      findings.push({
        check: "min-wall",
        severity: "fail",
        feature: wall.id,
        measured: round(wall.thicknessMm, 3),
        required: round(floor, 3),
        unit: "mm",
        message: `${wall.id} is ${mm(wall.thicknessMm)} thick, thinner than one ${mm(width)} bead from the ${printer.nozzleDiameterMm} mm nozzle. A wall thinner than one perimeter is not printable.`,
        fix: `Take ${wall.id} to at least ${mm(recommended)} (two perimeters), or fit a ${printer.nozzleDiameterMm > 0.2 ? "0.2" : "smaller"} mm nozzle if the thin wall is the point.`,
      });
    } else if (below(wall.thicknessMm, recommended)) {
      findings.push({
        check: "min-wall",
        severity: "warn",
        feature: wall.id,
        measured: round(wall.thicknessMm, 3),
        required: round(recommended, 3),
        unit: "mm",
        message: `${wall.id} is ${mm(wall.thicknessMm)} thick — one bead of ${mm(width)} will print, but not the two perimeters a load-bearing wall needs.`,
        fix: `Take ${wall.id} to ${mm(recommended)} or more. Perimeter count, not infill, is what carries load.`,
      });
    }
  }

  if (findings.length) return findings;

  const thinnest = walls.reduce((worst, wall) => (wall.thicknessMm < worst.thicknessMm ? wall : worst));
  return [
    {
      check: "min-wall",
      severity: "pass",
      feature: thinnest.id,
      measured: round(thinnest.thicknessMm, 3),
      required: round(recommended, 3),
      unit: "mm",
      message: `All ${walls.length} wall${walls.length === 1 ? "" : "s"} clear two perimeters. Thinnest is ${thinnest.id} at ${mm(thinnest.thicknessMm)} against a ${mm(recommended)} minimum.`,
      fix: "No change needed.",
    },
  ];
}

// ---------------------------------------------------------------------------
// Hole to edge
// ---------------------------------------------------------------------------

/**
 * @param diameterFor Diameter the hole will be MODELLED at, i.e. after printer
 *   compensation. That is the geometry the slicer sees and the larger of the two
 *   numbers, so it is the one the edge has to clear.
 */
export function checkHoleToEdge(
  holes: readonly HoleFeature[],
  printer: PrinterProfile,
  diameterFor: (hole: HoleFeature) => number,
): CheckFinding[] {
  const applicable = holes.filter((hole) => typeof hole.centerToEdgeMm === "number");
  if (!applicable.length) return [];

  const width = extrusionWidthMm(printer.nozzleDiameterMm);
  const findings: CheckFinding[] = [];
  let closest: { hole: HoleFeature; slackMm: number; recommendedMm: number } | undefined;

  for (const hole of applicable) {
    const centerToEdgeMm = hole.centerToEdgeMm as number;
    const diameterMm = diameterFor(hole);
    const radiusMm = diameterMm / 2;
    const remainingMm = centerToEdgeMm - radiusMm;
    const printableMm = radiusMm + MIN_WALL_PERIMETERS * width;
    const recommendedMm = Math.max(
      radiusMm + RECOMMENDED_WALL_PERIMETERS * width,
      HOLE_EDGE_DIAMETER_MULTIPLE * diameterMm,
    );

    if (below(centerToEdgeMm, printableMm)) {
      findings.push({
        check: "hole-to-edge",
        severity: "fail",
        feature: hole.id,
        measured: round(centerToEdgeMm, 3),
        required: round(printableMm, 3),
        unit: "mm",
        message:
          remainingMm <= 0
            ? `${hole.id} breaks out through the edge: its centre is ${mm(centerToEdgeMm)} from the edge but the modelled hole is ${mm(diameterMm)} across.`
            : `${hole.id} leaves ${mm(remainingMm)} of material to the nearest edge, less than one ${mm(width)} bead. There is no wall there to print.`,
        fix: `Move ${hole.id} to at least ${mm(recommendedMm)} from the edge (centre to edge), or grow the part around it.`,
      });
      continue;
    }

    if (below(centerToEdgeMm, recommendedMm)) {
      findings.push({
        check: "hole-to-edge",
        severity: "warn",
        feature: hole.id,
        measured: round(centerToEdgeMm, 3),
        required: round(recommendedMm, 3),
        unit: "mm",
        message: `${hole.id} sits ${mm(centerToEdgeMm)} from the nearest edge, leaving ${mm(remainingMm)} of material. Guidance wants ${mm(recommendedMm)} centre-to-edge — two perimeters of material, and 1.5x the hole diameter. The 1.5x figure is plastic-part design practice carried over from injection moulding, not an FDM-specific published number.`,
        fix: `Move ${hole.id} ${mm(recommendedMm - centerToEdgeMm)} further in, or accept the edge may tear when the bolt is torqued.`,
      });
      continue;
    }

    const slackMm = centerToEdgeMm - recommendedMm;
    if (!closest || slackMm < closest.slackMm) closest = { hole, slackMm, recommendedMm };
  }

  if (findings.length) return findings;
  if (!closest) return [];
  return [
    {
      check: "hole-to-edge",
      severity: "pass",
      feature: closest.hole.id,
      measured: round(closest.hole.centerToEdgeMm as number, 3),
      required: round(closest.recommendedMm, 3),
      unit: "mm",
      message: `All ${applicable.length} hole${applicable.length === 1 ? "" : "s"} clear the edge. Tightest is ${closest.hole.id} at ${mm(closest.hole.centerToEdgeMm as number)} centre-to-edge against ${mm(closest.recommendedMm)}.`,
      fix: "No change needed.",
    },
  ];
}

// ---------------------------------------------------------------------------
// Heat-set inserts
// ---------------------------------------------------------------------------

export function checkInsertDepth(
  inserts: readonly InsertFeature[],
  resolve: (feature: InsertFeature) => { insert: HeatSetInsert; inferred: boolean } | undefined,
  unresolved: readonly UnresolvedBoss[],
): CheckFinding[] {
  const findings: CheckFinding[] = [];

  for (const boss of unresolved) {
    findings.push({
      check: "insert-depth",
      severity: "warn",
      feature: `boss:${boss.bossId}`,
      measured: round(boss.boreDepthMm, 2),
      required: null,
      unit: "mm",
      message: `No tabulated heat-set insert installs into a ${mm(boss.boreDiameterMm)} bore, so the depth rule (insert length plus two thread pitches) cannot be applied to boss "${boss.bossId}".`,
      fix: `Name the insert for boss "${boss.bossId}" so its length is known, or take the bore depth from that supplier's own datasheet. Insert geometry is not interchangeable between brands.`,
    });
  }

  let tightest: { feature: InsertFeature; slackMm: number; requiredMm: number } | undefined;
  for (const feature of inserts) {
    const resolved = resolve(feature);
    if (!resolved) continue;
    const requiredMm = requiredBoreDepthMm(resolved.insert);
    const inferredNote = resolved.inferred
      ? ` The insert was inferred from the bore diameter as the longest tabulated body that installs into it; name it explicitly if it is a different one.`
      : "";
    if (below(feature.boreDepthMm, requiredMm)) {
      findings.push({
        check: "insert-depth",
        severity: "fail",
        feature: feature.id,
        measured: round(feature.boreDepthMm, 2),
        required: requiredMm,
        unit: "mm",
        message: `${feature.id} bores ${mm(feature.boreDepthMm)} for a ${resolved.insert.id}, which needs ${mm(requiredMm)} — its ${mm(resolved.insert.lengthMm)} body plus two thread pitches of room for the plastic it displaces.${inferredNote}`,
        fix: `Deepen the ${feature.id} bore to ${mm(requiredMm)}. Without that room the insert sits proud and the mating part will not seat flat.`,
      });
      continue;
    }
    const slackMm = feature.boreDepthMm - requiredMm;
    if (!tightest || slackMm < tightest.slackMm) tightest = { feature, slackMm, requiredMm };
  }

  if (tightest && !findings.some((finding) => finding.severity === "fail")) {
    findings.push({
      check: "insert-depth",
      severity: "pass",
      feature: tightest.feature.id,
      measured: round(tightest.feature.boreDepthMm, 2),
      required: tightest.requiredMm,
      unit: "mm",
      message: `Every insert bore has the depth its insert needs. Tightest is ${tightest.feature.id} at ${mm(tightest.feature.boreDepthMm)} against ${mm(tightest.requiredMm)}.`,
      fix: "No change needed.",
    });
  }
  return findings;
}

export function checkInsertBossWall(
  inserts: readonly InsertFeature[],
  resolve: (feature: InsertFeature) => { insert: HeatSetInsert; inferred: boolean } | undefined,
): CheckFinding[] {
  const findings: CheckFinding[] = [];
  let tightest: { feature: InsertFeature; slackMm: number; optimumMm: number } | undefined;

  for (const feature of inserts) {
    const resolved = resolve(feature);
    if (!resolved) continue;
    const minimumMm = requiredBossWallMm(resolved.insert);
    const optimumMm = optimumBossWallMm(resolved.insert);

    if (below(feature.bossWallMm, minimumMm)) {
      findings.push({
        check: "insert-boss-wall",
        severity: "fail",
        feature: feature.id,
        measured: round(feature.bossWallMm, 2),
        required: minimumMm,
        unit: "mm",
        message: `${feature.id} leaves ${mm(feature.bossWallMm)} of plastic around a ${resolved.insert.id}. A boss diameter of at least twice the ${mm(resolved.insert.outerDiameterMm)} insert is ${mm(minimumMm)} of radial material; below that the boss splits as the insert is pressed in.`,
        fix: `Grow the boss outer diameter to ${mm(2 * resolved.insert.outerDiameterMm)} (${mm(minimumMm)} of wall). Three times the insert diameter, ${mm(optimumMm)} of wall, is the optimum.`,
      });
      continue;
    }
    if (below(feature.bossWallMm, optimumMm)) {
      findings.push({
        check: "insert-boss-wall",
        severity: "warn",
        feature: feature.id,
        measured: round(feature.bossWallMm, 2),
        required: optimumMm,
        unit: "mm",
        message: `${feature.id} has ${mm(feature.bossWallMm)} of wall around a ${resolved.insert.id}, above the 2x minimum of ${mm(minimumMm)} but below the 3x optimum of ${mm(optimumMm)}.`,
        fix: `Grow the boss outer diameter to ${mm(BOSS_DIAMETER_OPTIMUM_MULTIPLE * resolved.insert.outerDiameterMm)} if the joint is loaded; leave it if the insert only locates a cover.`,
      });
      continue;
    }
    const slackMm = feature.bossWallMm - optimumMm;
    if (!tightest || slackMm < tightest.slackMm) tightest = { feature, slackMm, optimumMm };
  }

  if (findings.length) return findings;
  if (!tightest) return [];
  return [
    {
      check: "insert-boss-wall",
      severity: "pass",
      feature: tightest.feature.id,
      measured: round(tightest.feature.bossWallMm, 2),
      required: tightest.optimumMm,
      unit: "mm",
      message: `Every insert boss is at the 3x optimum wall or better. Tightest is ${tightest.feature.id} at ${mm(tightest.feature.bossWallMm)}.`,
      fix: "No change needed.",
    },
  ];
}

// ---------------------------------------------------------------------------
// Overhangs
// ---------------------------------------------------------------------------

export function checkOverhangs(overhangs: readonly OverhangFeature[]): CheckFinding[] {
  if (!overhangs.length) return [];
  const findings: CheckFinding[] = [];

  for (const overhang of overhangs) {
    const span = overhang.spanMm === undefined ? "" : ` over ${mm(overhang.spanMm)}`;
    if (overhang.angleFromVerticalDeg > OVERHANG_SUPPORT_DEG) {
      findings.push({
        check: "overhang",
        severity: "fail",
        feature: overhang.id,
        measured: round(overhang.angleFromVerticalDeg, 1),
        required: OVERHANG_CLEAN_DEG,
        unit: "deg",
        message: `${overhang.id} leans ${round(overhang.angleFromVerticalDeg, 1)} degrees off vertical${span}, past the ${OVERHANG_SUPPORT_DEG} degree limit for printing unsupported.`,
        fix: `Turn it into a ${OVERHANG_CLEAN_DEG} degree chamfer, reorient the part so the face runs steeper, or slice it with support under ${overhang.id}.`,
      });
      continue;
    }
    if (overhang.angleFromVerticalDeg > OVERHANG_CLEAN_DEG) {
      findings.push({
        check: "overhang",
        severity: "warn",
        feature: overhang.id,
        measured: round(overhang.angleFromVerticalDeg, 1),
        required: OVERHANG_CLEAN_DEG,
        unit: "deg",
        message: `${overhang.id} leans ${round(overhang.angleFromVerticalDeg, 1)} degrees off vertical${span}. Past ${OVERHANG_CLEAN_DEG} degrees the surface finish drops off; it prints without support up to ${OVERHANG_SUPPORT_DEG} degrees with good part cooling.`,
        fix: `Accept the rougher underside, or take ${overhang.id} back to ${OVERHANG_CLEAN_DEG} degrees.`,
      });
    }
  }

  if (findings.length) return findings;
  const steepest = overhangs.reduce((worst, overhang) =>
    overhang.angleFromVerticalDeg > worst.angleFromVerticalDeg ? overhang : worst,
  );
  return [
    {
      check: "overhang",
      severity: "pass",
      feature: steepest.id,
      measured: round(steepest.angleFromVerticalDeg, 1),
      required: OVERHANG_CLEAN_DEG,
      unit: "deg",
      message: `No face leans past ${OVERHANG_CLEAN_DEG} degrees off vertical. Steepest is ${steepest.id} at ${round(steepest.angleFromVerticalDeg, 1)} degrees.`,
      fix: "No change needed.",
    },
  ];
}

// ---------------------------------------------------------------------------
// Small features
// ---------------------------------------------------------------------------

export function checkSmallFeatures(
  features: readonly SmallFeature[],
  printer: PrinterProfile,
): CheckFinding[] {
  if (!features.length) return [];
  const width = extrusionWidthMm(printer.nozzleDiameterMm);
  const findings: CheckFinding[] = [];

  for (const feature of features) {
    const kind = feature.kind && feature.kind !== "other" ? `${feature.kind} ` : "";
    if (below(feature.minDimensionMm, width)) {
      findings.push({
        check: "small-feature",
        severity: "fail",
        feature: feature.id,
        measured: round(feature.minDimensionMm, 3),
        required: round(width, 3),
        unit: "mm",
        message: `${kind}${feature.id} is ${mm(feature.minDimensionMm)} across, narrower than the ${mm(width)} bead a ${printer.nozzleDiameterMm} mm nozzle lays. The slicer will drop it and the feature will not appear on the part.`,
        fix: `Take ${feature.id} to at least ${mm(2 * width)}, or print with a ${printer.supportedNozzleDiametersMm.includes(0.2) ? "0.2 mm" : "smaller"} nozzle.`,
      });
      continue;
    }
    if (below(feature.minDimensionMm, 2 * width)) {
      findings.push({
        check: "small-feature",
        severity: "warn",
        feature: feature.id,
        measured: round(feature.minDimensionMm, 3),
        required: round(2 * width, 3),
        unit: "mm",
        message: `${kind}${feature.id} is ${mm(feature.minDimensionMm)} across — a single ${mm(width)} bead wide, with no second perimeter to bond to. It will print, but it snaps off easily.`,
        fix: `Take ${feature.id} to ${mm(2 * width)} or more.`,
      });
    }
  }

  if (findings.length) return findings;
  const smallest = features.reduce((worst, feature) =>
    feature.minDimensionMm < worst.minDimensionMm ? feature : worst,
  );
  return [
    {
      check: "small-feature",
      severity: "pass",
      feature: smallest.id,
      measured: round(smallest.minDimensionMm, 3),
      required: round(2 * width, 3),
      unit: "mm",
      message: `Every detail is at least two beads wide. Smallest is ${smallest.id} at ${mm(smallest.minDimensionMm)} against ${mm(2 * width)}.`,
      fix: "No change needed.",
    },
  ];
}

// ---------------------------------------------------------------------------
// Printer / material pairing
// ---------------------------------------------------------------------------

/**
 * The pairing rules read the vendor flags on the two profiles, so the citation
 * for each of these lives on the profile itself (`printers.ts`, `materials.ts`).
 * Note that "enclosed" and "actively heated chamber" are separate: ABS needs the
 * box, and none of the P1S / P2S / X1C heat their chamber at all.
 */
export function checkPrinterMaterial(printer: PrinterProfile, material: MaterialProfile): CheckFinding[] {
  const machine = `${printer.brand} ${printer.model}`;
  const findings: CheckFinding[] = [];

  if (material.abrasive && printer.nozzleMaterial !== "hardened-steel") {
    findings.push({
      check: "nozzle-abrasion",
      severity: "fail",
      feature: printer.id,
      measured: null,
      required: null,
      unit: null,
      message: `${material.name} is fibre-filled and the ${machine} ships a ${printer.nozzleMaterial.replace("-", " ")} nozzle, which it will grind out within a spool or two.`,
      fix: `Fit a hardened steel nozzle (and the matching extruder gears) before running ${material.name}, or print this part in a non-abrasive filament.`,
    });
  } else {
    findings.push({
      check: "nozzle-abrasion",
      severity: "pass",
      feature: printer.id,
      measured: null,
      required: null,
      unit: null,
      message: material.abrasive
        ? `${material.name} is abrasive and the ${machine} has a hardened steel nozzle.`
        : `${material.name} is not abrasive; the ${machine}'s ${printer.nozzleMaterial.replace("-", " ")} nozzle is fine.`,
      fix: "No change needed.",
    });
  }

  if (material.requiresEnclosure && !printer.chamber.enclosed) {
    findings.push({
      check: "chamber-requirement",
      severity: "fail",
      feature: printer.id,
      measured: null,
      required: null,
      unit: null,
      message: `${material.name} needs a closed chamber and the ${machine} is an open frame. Large ${material.name} parts warp off the plate and delaminate.`,
      fix: `Fit the enclosure this machine offers, or print the part in PLA or PETG, which the ${machine} runs open.`,
    });
  } else if (material.prefersActiveChamber && !printer.chamber.activeHeating) {
    findings.push({
      check: "chamber-requirement",
      severity: "warn",
      feature: printer.id,
      measured: null,
      required: null,
      unit: null,
      message: `${material.name} does materially better in an ACTIVELY HEATED chamber. The ${machine} is enclosed${printer.chamber.maxC === null ? "" : ` and coasts to about ${printer.chamber.maxC} C off bed heat`}, but it does not heat the chamber.`,
      fix: `Print it here and expect some warping on tall or wide parts, or move it to a machine with active chamber heating. Keeping the door shut and the plate hot is what this machine can do.`,
    });
  } else {
    findings.push({
      check: "chamber-requirement",
      severity: "pass",
      feature: printer.id,
      measured: null,
      required: null,
      unit: null,
      message: `The ${machine} chamber suits ${material.name}${printer.chamber.activeHeating ? ` (actively heated to ${printer.chamber.maxC} C)` : printer.chamber.enclosed ? " (enclosed)" : ""}.`,
      fix: "No change needed.",
    });
  }

  if (material.typicalBedC > printer.maxBedC) {
    findings.push({
      check: "bed-temperature",
      severity: "fail",
      feature: printer.id,
      measured: material.typicalBedC,
      required: printer.maxBedC,
      unit: "C",
      message: `${material.name} typically wants a ${material.typicalBedC} C plate; the ${machine} tops out at ${printer.maxBedC} C.`,
      fix: `Print this part in a material that runs at or below ${printer.maxBedC} C, or move it to a machine with a hotter plate.`,
    });
  } else {
    findings.push({
      check: "bed-temperature",
      severity: "pass",
      feature: printer.id,
      measured: material.typicalBedC,
      required: printer.maxBedC,
      unit: "C",
      message: `${material.name}'s typical ${material.typicalBedC} C plate is within the ${machine}'s ${printer.maxBedC} C maximum.`,
      fix: "No change needed.",
    });
  }

  return findings;
}

/**
 * Say plainly whether the hole numbers in this report rest on a measured part or
 * on the PLA fit borrowed from another combination. A number that looks
 * authoritative and is not is worse than no number.
 */
export function checkCompensationCalibration(
  printer: PrinterProfile,
  material: MaterialProfile,
  calibrated: boolean,
  compensationMm: number,
): CheckFinding {
  if (calibrated) {
    return {
      check: "hole-compensation-calibration",
      severity: "pass",
      feature: `${printer.id}/${material.id}`,
      measured: round(compensationMm, 3),
      required: null,
      unit: "mm",
      message: `Hole compensation for ${material.name} on a ${printer.nozzleDiameterMm} mm ${printer.brand} nozzle is fitted to a measured part.`,
      fix: "No change needed.",
    };
  }
  return {
    check: "hole-compensation-calibration",
    severity: "warn",
    feature: `${printer.id}/${material.id}`,
    measured: round(compensationMm, 3),
    required: null,
    unit: "mm",
    message: `The hole compensation applied here is the PLA fit reused for ${material.name} on the ${printer.brand} ${printer.model} with a ${printer.nozzleDiameterMm} mm nozzle. It is a starting estimate, not a measurement of this combination.`,
    fix: `Print a coupon with the compensated diameters, measure the holes with pin gauges or calipers, and feed the difference back before committing a batch.`,
  };
}
