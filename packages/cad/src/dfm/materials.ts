/**
 * Material profiles.
 *
 * HONESTY NOTE ON SHRINKAGE. Filament vendors largely do not publish a linear
 * shrinkage figure. Polymaker states shrinkage rate is a property they intend to
 * *add* to a future revision of their technical data sheets, and Bambu Lab's own
 * documentation treats shrinkage as something the user measures rather than
 * looks up: it gives a print-a-cube-and-measure procedure and says the
 * "calibration is specific to each filament and should be repeated when changing
 * materials".
 * https://wiki.bambulab.com/en/knowledge-sharing/3d-prints-shrinkage
 *
 * So every `shrinkageFraction` below is a typical starting value carrying
 * `shrinkageVerified: false`. They are not presented as manufacturer specs, and
 * `checkPart` tells the caller to calibrate against a coupon. They are used only
 * as one small term of the hole-compensation model (about 0.01 mm on an M3
 * hole), so an error here moves a hole by microns, not millimetres.
 *
 * The enclosure/chamber flags, by contrast, ARE grounded in vendor filament
 * compatibility tables and are cited per material.
 */

import type { MaterialProfile } from "./types";

/**
 * Empirical constant, fitted — see `hole-compensation.ts` for the derivation.
 *
 * Fitted to the one measured ground truth available: an M3 normal-clearance hole
 * (ISO 273 nominal 3.40 mm) must be modelled at 3.62 mm to print correctly on a
 * Bambu X1C in PLA with a 0.4 mm nozzle.
 *
 *   total offset needed          = 3.62 - 3.40      = 0.220000 mm
 *   less curve-approximation     = 0.42^2 / (2*3.4) = 0.025941 mm
 *   less shrinkage               = 3.4 * 0.003      = 0.010200 mm
 *   remaining squish term        =                  = 0.183859 mm
 *   as a fraction of the 0.42 mm bead                = 0.437759
 *
 * Expressed as a fraction of extrusion width so it scales sensibly to a 0.6 or
 * 0.8 mm nozzle, where squish and elephant-foot effects both grow with bead size.
 */
const PLA_HOLE_SQUISH_FRACTION = 0.4378;

export const PLA: MaterialProfile = {
  id: "pla",
  name: "PLA",
  shrinkageFraction: 0.003,
  shrinkageVerified: false,
  requiresEnclosure: false,
  prefersActiveChamber: false,
  abrasive: false,
  typicalBedC: 55,
  typicalNozzleC: 220,
  holeSquishFractionOfExtrusionWidth: PLA_HOLE_SQUISH_FRACTION,
  holeCompensationCalibrated: true,
  notes: [
    "The only material/printer pair here with a measured hole-compensation calibration (Bambu X1C, 0.4 mm nozzle).",
  ],
  sources: ["https://wiki.bambulab.com/en/knowledge-sharing/3d-prints-shrinkage"],
};

export const PETG: MaterialProfile = {
  id: "petg",
  name: "PETG",
  shrinkageFraction: 0.004,
  shrinkageVerified: false,
  requiresEnclosure: false,
  prefersActiveChamber: false,
  abrasive: false,
  typicalBedC: 70,
  typicalNozzleC: 250,
  holeSquishFractionOfExtrusionWidth: PLA_HOLE_SQUISH_FRACTION,
  holeCompensationCalibrated: false,
  notes: [
    "Listed by Bambu as ideal on every open and enclosed machine here; no enclosure needed.",
    "PETG tends to string and to squish more than PLA: treat the inherited compensation as a starting point.",
  ],
  sources: ["https://us.store.bambulab.com/products/p1s"],
};

export const ABS: MaterialProfile = {
  id: "abs",
  name: "ABS",
  shrinkageFraction: 0.006,
  shrinkageVerified: false,
  // Bambu lists ABS/ASA as "Ideal" on the P1S, which is enclosed but has NO
  // active chamber heating. So ABS needs the box, not a heated chamber.
  requiresEnclosure: true,
  prefersActiveChamber: true,
  abrasive: false,
  typicalBedC: 100,
  typicalNozzleC: 270,
  holeSquishFractionOfExtrusionWidth: PLA_HOLE_SQUISH_FRACTION,
  holeCompensationCalibrated: false,
  notes: [
    "Warps badly on an open frame. Snapmaker gates ABS behind the U1's optional top cover.",
  ],
  sources: [
    "https://us.store.bambulab.com/products/p1s",
    "https://www.snapmaker.com/snapmaker-u1/specs",
  ],
};

export const ASA: MaterialProfile = {
  id: "asa",
  name: "ASA",
  shrinkageFraction: 0.006,
  shrinkageVerified: false,
  requiresEnclosure: true,
  prefersActiveChamber: true,
  abrasive: false,
  typicalBedC: 100,
  typicalNozzleC: 270,
  holeSquishFractionOfExtrusionWidth: PLA_HOLE_SQUISH_FRACTION,
  holeCompensationCalibrated: false,
  notes: ["UV-stable ABS alternative; same enclosure requirement."],
  sources: ["https://us.store.bambulab.com/products/p1s"],
};

export const PA_CF: MaterialProfile = {
  id: "pa-cf",
  name: "PA-CF (carbon-fibre nylon)",
  // Chopped fibre restrains the base polymer: Bambu notes fibre-reinforced
  // filament is itself a way to reduce shrinkage. Neat PA6 would be far higher.
  shrinkageFraction: 0.004,
  shrinkageVerified: false,
  requiresEnclosure: true,
  prefersActiveChamber: true,
  abrasive: true,
  typicalBedC: 100,
  typicalNozzleC: 290,
  holeSquishFractionOfExtrusionWidth: PLA_HOLE_SQUISH_FRACTION,
  holeCompensationCalibrated: false,
  notes: [
    "Abrasive: requires a hardened steel nozzle.",
    "Hygroscopic. Dry the spool before printing or dimensions and surface finish both drift.",
    "Bambu rates PA as ideal on the X1C and the H2 series, merely capable on the P1S.",
  ],
  sources: [
    "https://bambulab.com/en-us/compare",
    "https://wiki.bambulab.com/en/knowledge-sharing/3d-prints-shrinkage",
  ],
};

export const MATERIAL_PROFILES: readonly MaterialProfile[] = [PLA, PETG, ABS, ASA, PA_CF];

export function findMaterial(id: string): MaterialProfile | undefined {
  return MATERIAL_PROFILES.find((material) => material.id === id);
}

export function requireMaterial(id: string): MaterialProfile {
  const material = findMaterial(id);
  if (!material) {
    const known = MATERIAL_PROFILES.map((entry) => entry.id).join(", ");
    throw new Error(`Unknown material "${id}". Known materials: ${known}.`);
  }
  return material;
}
