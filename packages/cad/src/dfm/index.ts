/**
 * Design-for-manufacturing pass. `checkPart` is the entry point.
 *
 * This is the stage that runs FIRST, at zero Onshape calls. It takes the part
 * the agent is about to build, a printer id and a material id, and answers two
 * questions before a single API call is spent:
 *
 *   1. Will this part actually print on that machine in that filament?
 *   2. What diameters should be MODELLED, given that FDM prints holes undersized?
 *
 * The second answer is the one that is easy to get wrong quietly. A designer asks
 * for an M3 clearance hole — ISO 273 nominal 3.4 mm — and modelling 3.4 mm gets a
 * hole a bolt will not pass through. `compensateHoleDiameter` says model 3.62 mm
 * on a 0.4 mm Bambu nozzle in PLA, and `report.modelledDimensions` carries that
 * back to the exact field of the part definition so `applyDfmCompensation` can
 * write it in.
 *
 * NOTHING HERE TOUCHES THE NETWORK. No credential is read, no connection is
 * opened, nothing is resolved at import time. The printer and material tables are
 * plain data with their manufacturer URLs beside them.
 *
 * WHAT A REPORT IS HONEST ABOUT. Every finding names the feature at fault, what
 * it measures, what the rule wants, and one concrete change — never a bare
 * boolean. `notApplicable` lists rules that had nothing to check, so silence is
 * never mistaken for a pass. `usesUnverifiedProfile` is true whenever a number in
 * play is a typical value rather than a vendor specification; today that includes
 * every material shrinkage figure, because filament vendors do not publish them
 * (see the honesty note at the top of `materials.ts`).
 *
 * Two `PartDefinition` types meet here and they are NOT the same thing:
 *  - `ModelledPart` (re-exported from `featurescript/part-schema`) is the
 *    buildable geometry — the plate, the hole pattern, the boss. It is what
 *    `checkPart` takes.
 *  - `PartDefinition` (from `./types`) is the flat DFM description — walls, edge
 *    distances, bore depths — that the rules read. `derive.ts` maps the first
 *    onto the second.
 */

import {
  clonePartDefinition,
  setDefinitionPath,
  type PartDefinition as ModelledPart,
} from "../featurescript/part-schema";
import {
  bedFit,
  checkBedFit,
  checkCompensationCalibration,
  checkHoleToEdge,
  checkInsertBossWall,
  checkInsertDepth,
  checkOverhangs,
  checkPrinterMaterial,
  checkSmallFeatures,
  checkWalls,
  worstSeverity,
} from "./checks";
import { describeModelledPart, type DeriveOptions } from "./derive";
import {
  compensateHoleDiameter,
  compensateHoleFeature,
  compensationIsCalibrated,
  nominalHoleDiameterMm,
} from "./hole-compensation";
import { requiredBoreDepthMm } from "./inserts";
import { requireMaterial } from "./materials";
import { extrusionWidthMm, requirePrinter } from "./printers";
import type {
  CheckFinding,
  CheckId,
  CompensatedHole,
  DfmReport,
  HoleFeature,
  InsertFeature,
  ModelledDimension,
  Severity,
} from "./types";

export type CheckPartInput = DeriveOptions & {
  /** The part as it will be modelled. See `featurescript/part-schema`. */
  part: ModelledPart;
  /** Id from `PRINTER_PROFILES`. An unknown id throws, listing the known ones. */
  printerId: string;
  /** Id from `MATERIAL_PROFILES`. */
  materialId: string;
};

/** Every rule `checkPart` can run, in report order. */
const ALL_CHECKS: readonly CheckId[] = [
  "bed-fit",
  "min-wall",
  "hole-to-edge",
  "insert-depth",
  "insert-boss-wall",
  "overhang",
  "small-feature",
  "nozzle-abrasion",
  "chamber-requirement",
  "bed-temperature",
  "hole-compensation-calibration",
];

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function buildSummary(
  report: Omit<DfmReport, "summary">,
  printerLabel: string,
  materialLabel: string,
): string {
  const fails = report.findings.filter((finding) => finding.severity === "fail");
  const warns = report.findings.filter((finding) => finding.severity === "warn");
  const verdict =
    report.status === "fail"
      ? "will not print as modelled"
      : report.status === "warn"
        ? `will print with ${warns.length} thing${warns.length === 1 ? "" : "s"} to watch`
        : "passes every check";

  const parts = [
    `${report.part} on the ${printerLabel} in ${materialLabel} ${verdict} (${fails.length} fail, ${warns.length} warn).`,
  ];
  const headline = fails[0] ?? warns[0];
  if (headline) parts.push(headline.message);
  const first = report.modelledDimensions[0];
  if (first) {
    const others = report.modelledDimensions.length - 1;
    parts.push(
      `Model ${first.label} at ${first.modelMm} mm rather than the nominal ${first.nominalMm} mm${others > 0 ? `, plus ${others} other compensated diameter${others === 1 ? "" : "s"}` : ""}.`,
    );
  }
  if (report.usesUnverifiedProfile) {
    parts.push(
      "Some numbers behind this are typical values rather than vendor specifications — print a coupon before committing a batch.",
    );
  }
  return parts.join(" ");
}

/**
 * Run every local DFM rule against a part and return what to model.
 *
 * Throws only when the part cannot be interpreted at all — an unknown printer or
 * material id, or a definition the FeatureScript generator rejects. A part that
 * is merely a bad idea comes back as a report with `status: "fail"`, never as an
 * exception: the whole point is to hand the designer the reasons.
 */
export function checkPart(input: CheckPartInput): DfmReport {
  const printer = requirePrinter(input.printerId);
  const material = requireMaterial(input.materialId);
  const derived = describeModelledPart(input.part, input);
  const description = derived.description;

  // Compensation runs before the rules: the hole-to-edge check needs the
  // MODELLED diameter, not the nominal one, because the modelled hole is the
  // geometry the slicer actually sees.
  const compensatedHoles: CompensatedHole[] = (description.holes ?? []).map((hole) =>
    compensateHoleFeature(hole, printer, material),
  );
  const compensatedByFeature = new Map(compensatedHoles.map((hole) => [hole.featureId, hole]));

  const compensatedInsertBores: DfmReport["compensatedInsertBores"][number][] = [];
  const modelledDimensions: ModelledDimension[] = [];

  for (const hole of compensatedHoles) {
    const target = derived.diameterTargets.get(hole.featureId);
    if (!target) continue;
    modelledDimensions.push({
      path: target.path,
      label: target.label,
      nominalMm: hole.nominalDiameterMm,
      modelMm: hole.compensatedDiameterMm,
      reason: `+${hole.totalOffsetMm} mm for first-layer squish, the slicer walking the circle as straight segments, and print shrinkage (slicer radial equivalent ${hole.slicerRadialEquivalentMm} mm).`,
    });
  }

  for (const feature of description.inserts ?? []) {
    const resolved = derived.bossInserts.get(feature.id);
    if (!resolved) continue;
    const compensation = compensateHoleDiameter(resolved.insert.boreDiameterMm, printer, material);
    compensatedInsertBores.push({
      featureId: feature.id,
      insert: resolved.insert.id,
      nominalBoreMm: resolved.insert.boreDiameterMm,
      compensatedBoreMm: compensation.compensatedDiameterMm,
      requiredDepthMm: requiredBoreDepthMm(resolved.insert),
    });
    const target = derived.diameterTargets.get(feature.id);
    if (!target) continue;
    modelledDimensions.push({
      path: target.path,
      label: target.label,
      nominalMm: compensation.nominalDiameterMm,
      modelMm: compensation.compensatedDiameterMm,
      reason: `The ${resolved.insert.id} installation hole is ${resolved.insert.boreDiameterMm} mm. Model +${compensation.totalOffsetMm} mm so the printed bore lands there — an undersized bore over-squeezes the insert and bulges the boss.`,
    });
  }

  const fit = bedFit(description, printer);
  const resolveInsert = (feature: InsertFeature) => derived.bossInserts.get(feature.id);
  const diameterFor = (hole: HoleFeature): number =>
    compensatedByFeature.get(hole.id)?.compensatedDiameterMm ?? nominalHoleDiameterMm(hole);

  const representativeOffsetMm =
    compensatedHoles[0]?.totalOffsetMm ??
    (compensatedInsertBores[0]
      ? round(compensatedInsertBores[0].compensatedBoreMm - compensatedInsertBores[0].nominalBoreMm, 3)
      : 0);
  const calibrationFinding =
    compensatedHoles.length || compensatedInsertBores.length
      ? checkCompensationCalibration(
          printer,
          material,
          compensationIsCalibrated(printer, material),
          representativeOffsetMm,
        )
      : null;

  const findings: CheckFinding[] = [
    checkBedFit(description, printer, fit),
    ...checkWalls(description.walls ?? [], printer),
    ...checkHoleToEdge(description.holes ?? [], printer, diameterFor),
    ...checkInsertDepth(description.inserts ?? [], resolveInsert, derived.unresolvedBosses),
    ...checkInsertBossWall(description.inserts ?? [], resolveInsert),
    ...checkOverhangs(description.overhangs ?? []),
    ...checkSmallFeatures(description.smallFeatures ?? [], printer),
    ...checkPrinterMaterial(printer, material),
    ...(calibrationFinding ? [calibrationFinding] : []),
  ];

  const ran = new Set(findings.map((finding) => finding.check));
  const status: Severity = worstSeverity(findings);
  const insertsUnverified = [...derived.bossInserts.values()].some(({ insert }) => !insert.verified);

  const withoutSummary: Omit<DfmReport, "summary"> = {
    part: description.name,
    printerId: printer.id,
    materialId: material.id,
    nozzleDiameterMm: printer.nozzleDiameterMm,
    extrusionWidthMm: round(extrusionWidthMm(printer.nozzleDiameterMm), 3),
    status,
    findings,
    bedFit: fit,
    compensatedHoles,
    compensatedInsertBores,
    modelledDimensions,
    notApplicable: ALL_CHECKS.filter((check) => !ran.has(check)),
    usesUnverifiedProfile: !printer.specVerified || !material.shrinkageVerified || insertsUnverified,
  };

  return {
    ...withoutSummary,
    summary: buildSummary(withoutSummary, `${printer.brand} ${printer.model}`, material.name),
  };
}

/**
 * Write every compensated diameter back into a COPY of the part definition.
 *
 * The original is left alone: its nominal numbers are what the designer asked
 * for and what the printed part is measured against, so they stay addressable.
 * The returned clone is what `generatePartFeatureScript` should be handed.
 */
export function applyDfmCompensation(part: ModelledPart, report: DfmReport): ModelledPart {
  const compensated = clonePartDefinition(part);
  for (const dimension of report.modelledDimensions) {
    setDefinitionPath(compensated, dimension.path, dimension.modelMm);
  }
  return compensated;
}

/** Plain-text report for an agent transcript or an approval prompt. */
export function describeDfmReport(report: DfmReport): string {
  const lines: string[] = [
    `DFM ${report.status.toUpperCase()} — ${report.part} on ${report.printerId} in ${report.materialId} (${report.nozzleDiameterMm} mm nozzle, ${report.extrusionWidthMm} mm bead)`,
    report.summary,
    "",
  ];
  for (const finding of report.findings) {
    const unit = finding.unit ?? "";
    const measured = finding.measured === null ? "" : ` [${finding.measured}${unit}`;
    const required =
      finding.measured === null ? "" : finding.required === null ? "]" : ` vs ${finding.required}${unit}]`;
    lines.push(
      `${finding.severity.toUpperCase().padEnd(4)} ${finding.check} · ${finding.feature}${measured}${required}`,
      `     ${finding.message}`,
      `     Fix: ${finding.fix}`,
    );
  }
  if (report.modelledDimensions.length) {
    lines.push("", "Model these instead of the nominal values:");
    for (const dimension of report.modelledDimensions) {
      lines.push(
        `  ${dimension.path} — ${dimension.label}: ${dimension.modelMm} mm (nominal ${dimension.nominalMm} mm)`,
      );
    }
  }
  if (report.notApplicable.length) {
    lines.push("", `Nothing on this part to check for: ${report.notApplicable.join(", ")}.`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export {
  BAMBU_LAB_H2D,
  BAMBU_LAB_H2S,
  BAMBU_LAB_P1S,
  BAMBU_LAB_P2S,
  BAMBU_LAB_X1C,
  EXTRUSION_WIDTH_RATIO,
  PRINTER_PROFILES,
  SNAPMAKER_U1,
  extrusionWidthMm,
  findPrinter,
  requirePrinter,
  usableHeightMm,
} from "./printers";
export { ABS, ASA, MATERIAL_PROFILES, PA_CF, PETG, PLA, findMaterial, requireMaterial } from "./materials";
export {
  HEAT_SET_INSERTS,
  findInsert,
  insertsForThread,
  requireInsert,
  requiredBoreDepthMm,
  requiredBossWallMm,
  type HeatSetInsert,
} from "./inserts";
export {
  METRIC_THREADS,
  clearanceHoleMm,
  coarsePitchMm,
  isMetricThread,
  majorDiameterMm,
  tapDrillMm,
} from "./threads";
export {
  compensateHoleDiameter,
  compensateHoleFeature,
  compensationIsCalibrated,
  curveApproximationOffsetMm,
  defaultInsertIdForThread,
  nominalHoleDiameterMm,
  shrinkageOffsetMm,
  squishOffsetMm,
  type DiameterCompensation,
} from "./hole-compensation";
export {
  BOSS_DIAMETER_OPTIMUM_MULTIPLE,
  HOLE_EDGE_DIAMETER_MULTIPLE,
  MIN_WALL_PERIMETERS,
  OVERHANG_CLEAN_DEG,
  OVERHANG_SUPPORT_DEG,
  RECOMMENDED_WALL_PERIMETERS,
  ROTATION_SEARCH_STEP_DEG,
  bedFit,
  footprintFitsAtDeg,
  minimumWallMm,
  optimumBossWallMm,
  recommendedWallMm,
  smallestFittingRotationDeg,
  worstSeverity,
} from "./checks";
export {
  baseFootprintMm,
  describeModelledPart,
  topFaceZMm,
  type DeriveOptions,
  type DerivedPart,
} from "./derive";
export type {
  BedFitResult,
  CheckFinding,
  CheckId,
  ClearanceFit,
  CompensatedHole,
  DfmReport,
  HoleFeature,
  HoleKind,
  InsertFeature,
  MaterialProfile,
  MetricThread,
  ModelledDimension,
  MultiMaterialKind,
  OverhangFeature,
  PartDefinition,
  PrinterProfile,
  Severity,
  SmallFeature,
  Vec3,
  WallFeature,
} from "./types";
/**
 * The buildable geometry `checkPart` takes, re-exported under an unambiguous
 * name: `./types` already exports a `PartDefinition`, and that one is the flat
 * DFM description, not this.
 */
export type { PartDefinition as ModelledPart } from "../featurescript/part-schema";
