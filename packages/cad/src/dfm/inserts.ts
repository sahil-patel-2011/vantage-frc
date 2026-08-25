/**
 * Heat-set insert table for the sizes FRC teams actually use.
 *
 * Dimensions are the CNC Kitchen / ruthex insert geometry, which is what most
 * teams buy. Two independent sources agree on the installation hole diameters,
 * which is why they are trusted here:
 *
 *  - A full published table of thread size / length / outer diameter / hole
 *    diameter for the CNC Kitchen range:
 *    https://kb-3d.com/store/inserts-fasteners-adhesives/927-cnckitchen-lead-cadmium-free-heat-set-inserts-multiple-sizes-metric.html
 *  - ruthex sell a drill set "for thread insert sizes M2, M2.5, M3, M4, M5, M6"
 *    containing exactly 3.2, 4.0, 5.6, 6.4 and 8.0 mm bits, which maps onto the
 *    same hole diameters size for size:
 *    https://www.ruthex.de/en/products/ruthex-hss-bohrer-set-5-tlg-fur-gewindeeinsatze-m2-m2-5-m3-m4-m5-m6-din-338-bohrer-3-2-4-0-5-6-6-4-8-0-mm-fur-kunststoff-stahl-alu-kupfer-messing-uvm
 *
 * ruthex's own catalogue confirms the lengths (M3x5.7, M4x8.1, M5x9.5, M6x12.7,
 * M8x12.7): https://www.ruthex.de/en/pages/cad-daten
 *
 * Bore depth and boss wall come from SPIROL's insert design guidance rather than
 * from folklore:
 *  - "The recommended minimum hole depth is the Insert length plus two (2)
 *    thread pitches."
 *  - "the optimum wall thickness or boss diameter of the plastic is two (2) to
 *    three (3) times the Insert diameter"
 *    https://www.spirol.com/resources/white-papers/how-to-design-the-proper-hole-for-heat-ultrasonic-inserts/
 *
 * Insert geometry differs between brands. Anything outside this table should be
 * taken from that supplier's own datasheet, not interpolated from these rows.
 */

import { coarsePitchMm } from "./threads";
import type { MetricThread } from "./types";

export type HeatSetInsert = {
  /** "M3x5.7" — thread and body length. */
  id: string;
  thread: MetricThread;
  lengthMm: number;
  outerDiameterMm: number;
  /** Manufacturer's recommended installation hole diameter, before print compensation. */
  boreDiameterMm: number;
  /** False if any dimension could not be confirmed against published data. */
  verified: boolean;
  sources: readonly string[];
};

const KB3D_TABLE =
  "https://kb-3d.com/store/inserts-fasteners-adhesives/927-cnckitchen-lead-cadmium-free-heat-set-inserts-multiple-sizes-metric.html";
const RUTHEX_DRILLS =
  "https://www.ruthex.de/en/products/ruthex-hss-bohrer-set-5-tlg-fur-gewindeeinsatze-m2-m2-5-m3-m4-m5-m6-din-338-bohrer-3-2-4-0-5-6-6-4-8-0-mm-fur-kunststoff-stahl-alu-kupfer-messing-uvm";

export const HEAT_SET_INSERTS: readonly HeatSetInsert[] = [
  {
    id: "M2x3",
    thread: "M2",
    lengthMm: 3,
    outerDiameterMm: 3.6,
    boreDiameterMm: 3.2,
    verified: true,
    sources: [KB3D_TABLE, RUTHEX_DRILLS],
  },
  {
    id: "M2.5x4",
    thread: "M2.5",
    lengthMm: 4,
    outerDiameterMm: 4.6,
    boreDiameterMm: 4.0,
    verified: true,
    sources: [KB3D_TABLE],
  },
  {
    id: "M3x3",
    thread: "M3",
    lengthMm: 3,
    outerDiameterMm: 4.6,
    boreDiameterMm: 4.0,
    verified: true,
    sources: [KB3D_TABLE],
  },
  {
    id: "M3x4",
    thread: "M3",
    lengthMm: 4,
    outerDiameterMm: 5.0,
    boreDiameterMm: 4.4,
    verified: true,
    sources: [KB3D_TABLE],
  },
  {
    // The default M3 for most teams: ruthex RX-M3x5.7 and CNC Kitchen agree.
    id: "M3x5.7",
    thread: "M3",
    lengthMm: 5.7,
    outerDiameterMm: 4.6,
    boreDiameterMm: 4.0,
    verified: true,
    sources: [KB3D_TABLE, RUTHEX_DRILLS],
  },
  {
    id: "M4x4",
    thread: "M4",
    lengthMm: 4,
    outerDiameterMm: 6.3,
    boreDiameterMm: 5.6,
    verified: true,
    sources: [KB3D_TABLE],
  },
  {
    id: "M4x8.1",
    thread: "M4",
    lengthMm: 8.1,
    outerDiameterMm: 6.3,
    boreDiameterMm: 5.6,
    verified: true,
    sources: [KB3D_TABLE, RUTHEX_DRILLS],
  },
  {
    id: "M5x5.8",
    thread: "M5",
    lengthMm: 5.8,
    outerDiameterMm: 7.1,
    boreDiameterMm: 6.4,
    verified: true,
    sources: [KB3D_TABLE],
  },
  {
    id: "M5x9.5",
    thread: "M5",
    lengthMm: 9.5,
    outerDiameterMm: 7.1,
    boreDiameterMm: 6.4,
    verified: true,
    sources: [KB3D_TABLE, RUTHEX_DRILLS],
  },
  {
    id: "M6x12.7",
    thread: "M6",
    lengthMm: 12.7,
    outerDiameterMm: 8.7,
    boreDiameterMm: 8.0,
    verified: true,
    sources: [KB3D_TABLE, RUTHEX_DRILLS],
  },
  {
    id: "M8x12.7",
    thread: "M8",
    lengthMm: 12.7,
    outerDiameterMm: 10.2,
    boreDiameterMm: 9.7,
    verified: true,
    sources: [KB3D_TABLE],
  },
];

export function findInsert(id: string): HeatSetInsert | undefined {
  return HEAT_SET_INSERTS.find((insert) => insert.id === id);
}

export function requireInsert(id: string): HeatSetInsert {
  const insert = findInsert(id);
  if (!insert) {
    const known = HEAT_SET_INSERTS.map((entry) => entry.id).join(", ");
    throw new Error(`Unknown heat-set insert "${id}". Known inserts: ${known}.`);
  }
  return insert;
}

export function insertsForThread(thread: MetricThread): readonly HeatSetInsert[] {
  return HEAT_SET_INSERTS.filter((insert) => insert.thread === thread);
}

/**
 * SPIROL minimum blind-hole depth: insert length + two thread pitches. The extra
 * depth is where displaced plastic goes; without it the insert sits proud.
 */
export function requiredBoreDepthMm(insert: HeatSetInsert): number {
  const depth = insert.lengthMm + 2 * coarsePitchMm(insert.thread);
  return Math.round(depth * 100) / 100;
}

/**
 * Radial material required from the bore wall out to the nearest free surface,
 * taking SPIROL's lower bound of a boss diameter twice the insert diameter.
 */
export function requiredBossWallMm(insert: HeatSetInsert): number {
  const wall = (2 * insert.outerDiameterMm - insert.boreDiameterMm) / 2;
  return Math.round(wall * 100) / 100;
}
