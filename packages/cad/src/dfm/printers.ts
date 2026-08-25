/**
 * Printer profiles.
 *
 * Every dimension and temperature below was read off the manufacturer's own
 * published specification; the URL sits next to the profile it justifies. A
 * fabricated build volume or nozzle size produces failed prints and wasted
 * filament, so a spec that could not be confirmed is marked `specVerified:false`
 * and surfaced in the report rather than guessed.
 *
 * Two findings worth recording, because they contradict common assumptions:
 *
 * 1. "P2S" is a REAL Bambu Lab product, not a typo for P1S. It is listed and
 *    sold alongside the P1S, which Bambu says it has no plans to discontinue.
 *    Both profiles are therefore provided.
 * 2. None of the P1S / P2S / X1C have an actively heated chamber. They are
 *    enclosed and regulate chamber temperature with a fan; Bambu states this
 *    outright for the P2S. Only the H2D and H2S heat the chamber (65 C).
 *    "Enclosed" and "heated chamber" are tracked as separate fields for this
 *    reason — ABS/ASA need the former, not the latter.
 */

import type { PrinterProfile } from "./types";

/**
 * A slicer lays a bead slightly wider than the nozzle bore so neighbouring beads
 * bond. 1.05 reproduces Bambu Studio's documented 0.42 mm default line width for
 * a 0.4 mm nozzle (0.4 * 1.05 = 0.42).
 *
 * This is a slicer default, not a hardware specification.
 * https://forum.bambulab.com/t/default-line-width-of-0-42/20400
 */
export const EXTRUSION_WIDTH_RATIO = 1.05;

/** Bead width a given nozzle actually deposits. */
export function extrusionWidthMm(nozzleDiameterMm: number): number {
  return nozzleDiameterMm * EXTRUSION_WIDTH_RATIO;
}

const BAMBU_NOZZLE_SIZES = [0.2, 0.4, 0.6, 0.8] as const;

export const BAMBU_LAB_P1S: PrinterProfile = {
  id: "bambu-p1s",
  brand: "Bambu Lab",
  model: "P1S",
  // "Build Volume(WxDxH) 256 x 256 x 256 mm3"
  buildVolumeMm: { x: 256, y: 256, z: 256 },
  // Bambu's own footnote: "To prevent heatbed damage caused by collisions with
  // foreign objects, the default printable height in Bambu Studio is set to
  // 250mm." The remaining 6 mm needs a documented procedure, so 250 is the
  // height a part can rely on.
  defaultMaxZMm: 250,
  // "Nozzle 0.4 mm Stainless Steel Included"
  nozzleDiameterMm: 0.4,
  supportedNozzleDiametersMm: BAMBU_NOZZLE_SIZES,
  nozzleMaterial: "stainless-steel",
  maxNozzleC: 300, // "Max Hot End Temperature 300 C"
  maxBedC: 100, // "Max Build Plate Temperature 100 C"
  chamber: { activeHeating: false, maxC: null, enclosed: true },
  toolheads: 1,
  multiMaterial: "ams-single-nozzle",
  specVerified: true,
  sources: ["https://us.store.bambulab.com/products/p1s"],
  notes: [
    "Ships with a stainless-steel nozzle: Bambu advises an extruder and hotend upgrade before printing fibre-reinforced filament.",
    "Enclosed with a chamber temperature regulator fan, but no active chamber heating.",
  ],
};

export const BAMBU_LAB_P2S: PrinterProfile = {
  id: "bambu-p2s",
  brand: "Bambu Lab",
  model: "P2S",
  // "Build Volume (W*D*H) 256*256*256 mm3"
  buildVolumeMm: { x: 256, y: 256, z: 256 },
  defaultMaxZMm: null,
  // "Included Nozzle Diameter 0.4 mm" / "Nozzle Hardened Steel"
  nozzleDiameterMm: 0.4,
  supportedNozzleDiametersMm: BAMBU_NOZZLE_SIZES,
  nozzleMaterial: "hardened-steel",
  maxNozzleC: 300, // "Max Nozzle Temperature 300 C"
  maxBedC: 110, // heatbed range given as 35-110 C
  // Bambu FAQ, verbatim: "The P2S does not have an active chamber heating
  // function, but it can regulate chamber temperature through its enclosed
  // chamber and automatic switching flap." Marketing's "50 C chamber ready" is
  // heat retention, not heating.
  chamber: { activeHeating: false, maxC: null, enclosed: true },
  toolheads: 1,
  multiMaterial: "ams-single-nozzle",
  specVerified: true,
  sources: ["https://us.store.bambulab.com/products/p2s"],
  notes: [
    "Hardened steel nozzle and extruder gear as shipped: fibre-reinforced filament needs no upgrade.",
    "P2S is a distinct current product, not a rename of the P1S.",
  ],
};

export const BAMBU_LAB_X1C: PrinterProfile = {
  id: "bambu-x1c",
  brand: "Bambu Lab",
  model: "X1 Carbon",
  // Bambu comparison table, X1C column: "Build Volume 256mm*256mm*256mm"
  buildVolumeMm: { x: 256, y: 256, z: 256 },
  defaultMaxZMm: null,
  // "X1C comes standard with a 0.4mm hardened steel nozzle"
  // https://wiki.bambulab.com/en/filament-acc/acc/nozzles
  nozzleDiameterMm: 0.4,
  supportedNozzleDiametersMm: BAMBU_NOZZLE_SIZES,
  nozzleMaterial: "hardened-steel",
  maxNozzleC: 300, // X1 series page: "All-Metal Hotend 300 C"
  // Comparison table: "Max Build Plate Temperature: 110 C @220 V, 120 C @110 V".
  // 110 is the value that holds on either mains supply.
  maxBedC: 110,
  // The X1C regulates chamber temperature with a fan and reaches ~60 C from bed
  // heat; it does not actively heat the chamber. (The X1E is the variant with
  // active chamber heating.)
  chamber: { activeHeating: false, maxC: 60, enclosed: true },
  toolheads: 1,
  multiMaterial: "ams-single-nozzle",
  specVerified: true,
  sources: [
    "https://bambulab.com/en-us/compare",
    "https://bambulab.com/en-us/x1",
    "https://wiki.bambulab.com/en/filament-acc/acc/nozzles",
  ],
  notes: [
    "Bed reaches 120 C only on a 110 V supply; 110 C on 220 V.",
    "No longer listed in the Bambu Lab US store lineup, but widely deployed on FRC teams.",
  ],
};

export const BAMBU_LAB_H2D: PrinterProfile = {
  id: "bambu-h2d",
  brand: "Bambu Lab",
  model: "H2D",
  // Tech specs, verbatim: "Single Nozzle Printing: 325mm*320mm*325mm /
  // Dual Nozzle Printing: 300mm*320mm*320mm / Total Volume for Two Nozzles:
  // 350mm*320mm*320mm". A single part printed with one nozzle gets the first,
  // which is what a bed-fit check needs.
  buildVolumeMm: { x: 325, y: 320, z: 325 },
  defaultMaxZMm: null,
  nozzleDiameterMm: 0.4, // "Included Nozzle Diameter 0.4 mm"
  supportedNozzleDiametersMm: BAMBU_NOZZLE_SIZES,
  nozzleMaterial: "hardened-steel",
  maxNozzleC: 350, // "Max Nozzle Temperature 350 C"
  maxBedC: 120, // "Max Heatbed Temperature 120 C"
  // "Active Chamber Heating: Supported / Max Temperature 65 C"
  chamber: { activeHeating: true, maxC: 65, enclosed: true },
  toolheads: 2,
  multiMaterial: "dual-nozzle",
  specVerified: true,
  sources: ["https://bambulab.com/en-us/h2d/tech-specs"],
  notes: [
    "Dual-nozzle printing drops the envelope to 300 x 320 x 320 mm.",
    "The store product page lists the dual/total heights as 325 mm; the technical specification page says 320 mm. The tech-spec figure is used here.",
  ],
};

export const BAMBU_LAB_H2S: PrinterProfile = {
  id: "bambu-h2s",
  brand: "Bambu Lab",
  model: "H2S",
  buildVolumeMm: { x: 340, y: 320, z: 340 }, // "Build Volume (W*D*H) 340mm*320mm*340mm"
  defaultMaxZMm: null,
  nozzleDiameterMm: 0.4, // "Included Nozzle Diameter 0.4 mm"
  supportedNozzleDiametersMm: BAMBU_NOZZLE_SIZES,
  nozzleMaterial: "hardened-steel",
  maxNozzleC: 350, // "Max Nozzle Temperature 350 C"
  maxBedC: 120, // "Max Heatbed Temperature 120 C"
  chamber: { activeHeating: true, maxC: 65, enclosed: true },
  toolheads: 1,
  multiMaterial: "ams-single-nozzle",
  specVerified: true,
  sources: ["https://bambulab.com/en-us/h2s/tech-specs"],
  notes: ["Single-nozzle machine with the H2 chassis: largest envelope of the profiles here."],
};

export const SNAPMAKER_U1: PrinterProfile = {
  id: "snapmaker-u1",
  brand: "Snapmaker",
  model: "U1",
  buildVolumeMm: { x: 270, y: 270, z: 270 }, // "Build Volume 270mm x 270mm x 270mm"
  defaultMaxZMm: null,
  nozzleDiameterMm: 0.4, // "Nozzle Diameter 0.4mm" / "Nozzle Stainless Steel"
  // Snapmaker's specification page lists only 0.4 mm. Other diameters are not
  // published there, so none are claimed.
  supportedNozzleDiametersMm: [0.4],
  nozzleMaterial: "stainless-steel",
  maxNozzleC: 300, // "Max Nozzle Temperature 300 C"
  maxBedC: 100, // "Max Heated Bed Temperature 100 C"
  // Open frame as sold. Snapmaker gates ABS/ASA/PA/PC behind an optional top
  // cover and lists no chamber heating at all.
  chamber: { activeHeating: false, maxC: null, enclosed: false },
  toolheads: 4, // "Toolheads Included 4"
  multiMaterial: "toolchanger",
  specVerified: true,
  sources: ["https://www.snapmaker.com/snapmaker-u1/specs"],
  notes: [
    "True 4-toolhead toolchanger: material changes swap a preheated toolhead instead of purging one nozzle.",
    "Without the optional top cover Snapmaker lists only PLA, PETG, TPU, PVA and PCTG as compatible.",
    "Carbon- and glass-fibre filament needs the top cover AND a hardened steel nozzle.",
  ],
};

export const PRINTER_PROFILES: readonly PrinterProfile[] = [
  BAMBU_LAB_P1S,
  BAMBU_LAB_P2S,
  BAMBU_LAB_X1C,
  BAMBU_LAB_H2D,
  BAMBU_LAB_H2S,
  SNAPMAKER_U1,
];

export function findPrinter(id: string): PrinterProfile | undefined {
  return PRINTER_PROFILES.find((printer) => printer.id === id);
}

/** Throws with the list of known ids rather than silently falling back to a default machine. */
export function requirePrinter(id: string): PrinterProfile {
  const printer = findPrinter(id);
  if (!printer) {
    const known = PRINTER_PROFILES.map((entry) => entry.id).join(", ");
    throw new Error(`Unknown printer "${id}". Known printers: ${known}.`);
  }
  return printer;
}

/** Z a part can actually rely on, honouring a vendor slicer default below the advertised volume. */
export function usableHeightMm(printer: PrinterProfile): number {
  return printer.defaultMaxZMm ?? printer.buildVolumeMm.z;
}
