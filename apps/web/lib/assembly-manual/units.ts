/**
 * Units and drill-size lookup.
 *
 * FRC shops work in inches for stock and in number/letter drills for holes, so
 * the manual prints inches. Onshape reports SI, so every conversion happens here
 * exactly once.
 *
 * The drill table is the published ANSI number/letter series — a physical
 * standard, not an estimate. A diameter that does not match a standard drill
 * within half a thousandth gets NO designation rather than the nearest one: a
 * student who reads "#9" and picks up a #9 must get the hole the CAD asked for.
 */

const MM_PER_INCH = 25.4;

export function mmToInch(mm: number): number {
  return mm / MM_PER_INCH;
}

export function inchToMm(inch: number): number {
  return inch * MM_PER_INCH;
}

export function metresToMm(m: number): number {
  return m * 1000;
}

/** "17.50 in" — two decimals is the shop's resolution for stock length. */
export function formatInches(mm: number, decimals = 2): string {
  return `${mmToInch(mm).toFixed(decimals)} in`;
}

/** "Ø0.196 in" — three decimals, because drills are specified to thousandths. */
export function formatDiameterInches(mm: number): string {
  return `Ø${mmToInch(mm).toFixed(3)} in`;
}

export function formatMm(mm: number, decimals = 2): string {
  return `${mm.toFixed(decimals)} mm`;
}

export function formatMassKg(kg: number): string {
  const lb = kg * 2.2046226218;
  return `${kg.toFixed(3)} kg (${lb.toFixed(2)} lb)`;
}

/**
 * ANSI number and letter drills, plus the fractional series to 1/2".
 * Diameters in inches, exactly as published.
 */
const DRILL_SIZES: Array<{ label: string; inch: number }> = [
  { label: "#80", inch: 0.0135 }, { label: "#79", inch: 0.0145 },
  { label: "1/64", inch: 0.015625 },
  { label: "#78", inch: 0.016 }, { label: "#77", inch: 0.018 },
  { label: "#76", inch: 0.02 }, { label: "#75", inch: 0.021 },
  { label: "#74", inch: 0.0225 }, { label: "#73", inch: 0.024 },
  { label: "#72", inch: 0.025 }, { label: "#71", inch: 0.026 },
  { label: "#70", inch: 0.028 }, { label: "#69", inch: 0.0292 },
  { label: "#68", inch: 0.031 }, { label: "1/32", inch: 0.03125 },
  { label: "#67", inch: 0.032 }, { label: "#66", inch: 0.033 },
  { label: "#65", inch: 0.035 }, { label: "#64", inch: 0.036 },
  { label: "#63", inch: 0.037 }, { label: "#62", inch: 0.038 },
  { label: "#61", inch: 0.039 }, { label: "#60", inch: 0.04 },
  { label: "#59", inch: 0.041 }, { label: "#58", inch: 0.042 },
  { label: "#57", inch: 0.043 }, { label: "#56", inch: 0.0465 },
  { label: "3/64", inch: 0.046875 },
  { label: "#55", inch: 0.052 }, { label: "#54", inch: 0.055 },
  { label: "#53", inch: 0.0595 }, { label: "1/16", inch: 0.0625 },
  { label: "#52", inch: 0.0635 }, { label: "#51", inch: 0.067 },
  { label: "#50", inch: 0.07 }, { label: "#49", inch: 0.073 },
  { label: "#48", inch: 0.076 }, { label: "5/64", inch: 0.078125 },
  { label: "#47", inch: 0.0785 }, { label: "#46", inch: 0.081 },
  { label: "#45", inch: 0.082 }, { label: "#44", inch: 0.086 },
  { label: "#43", inch: 0.089 }, { label: "#42", inch: 0.0935 },
  { label: "3/32", inch: 0.09375 },
  { label: "#41", inch: 0.096 }, { label: "#40", inch: 0.098 },
  { label: "#39", inch: 0.0995 }, { label: "#38", inch: 0.1015 },
  { label: "#37", inch: 0.104 }, { label: "#36", inch: 0.1065 },
  { label: "7/64", inch: 0.109375 },
  { label: "#35", inch: 0.11 }, { label: "#34", inch: 0.111 },
  { label: "#33", inch: 0.113 }, { label: "#32", inch: 0.116 },
  { label: "#31", inch: 0.12 }, { label: "1/8", inch: 0.125 },
  { label: "#30", inch: 0.1285 }, { label: "#29", inch: 0.136 },
  { label: "#28", inch: 0.1405 }, { label: "9/64", inch: 0.140625 },
  { label: "#27", inch: 0.144 }, { label: "#26", inch: 0.147 },
  { label: "#25", inch: 0.1495 }, { label: "#24", inch: 0.152 },
  { label: "#23", inch: 0.154 }, { label: "5/32", inch: 0.15625 },
  { label: "#22", inch: 0.157 }, { label: "#21", inch: 0.159 },
  { label: "#20", inch: 0.161 }, { label: "#19", inch: 0.166 },
  { label: "#18", inch: 0.1695 }, { label: "11/64", inch: 0.171875 },
  { label: "#17", inch: 0.173 }, { label: "#16", inch: 0.177 },
  { label: "#15", inch: 0.18 }, { label: "#14", inch: 0.182 },
  { label: "#13", inch: 0.185 }, { label: "3/16", inch: 0.1875 },
  { label: "#12", inch: 0.189 }, { label: "#11", inch: 0.191 },
  { label: "#10", inch: 0.1935 }, { label: "#9", inch: 0.196 },
  { label: "#8", inch: 0.199 }, { label: "#7", inch: 0.201 },
  { label: "13/64", inch: 0.203125 },
  { label: "#6", inch: 0.204 }, { label: "#5", inch: 0.2055 },
  { label: "#4", inch: 0.209 }, { label: "#3", inch: 0.213 },
  { label: "7/32", inch: 0.21875 },
  { label: "#2", inch: 0.221 }, { label: "#1", inch: 0.228 },
  { label: "A", inch: 0.234 }, { label: "15/64", inch: 0.234375 },
  { label: "B", inch: 0.238 }, { label: "C", inch: 0.242 },
  { label: "D", inch: 0.246 }, { label: "1/4", inch: 0.25 },
  { label: "F", inch: 0.257 }, { label: "G", inch: 0.261 },
  { label: "17/64", inch: 0.265625 },
  { label: "H", inch: 0.266 }, { label: "I", inch: 0.272 },
  { label: "J", inch: 0.277 }, { label: "K", inch: 0.281 },
  { label: "9/32", inch: 0.28125 },
  { label: "L", inch: 0.29 }, { label: "M", inch: 0.295 },
  { label: "19/64", inch: 0.296875 },
  { label: "N", inch: 0.302 }, { label: "5/16", inch: 0.3125 },
  { label: "O", inch: 0.316 }, { label: "P", inch: 0.323 },
  { label: "21/64", inch: 0.328125 },
  { label: "Q", inch: 0.332 }, { label: "R", inch: 0.339 },
  { label: "11/32", inch: 0.34375 },
  { label: "S", inch: 0.348 }, { label: "T", inch: 0.358 },
  { label: "23/64", inch: 0.359375 },
  { label: "U", inch: 0.368 }, { label: "3/8", inch: 0.375 },
  { label: "V", inch: 0.377 }, { label: "W", inch: 0.386 },
  { label: "25/64", inch: 0.390625 },
  { label: "X", inch: 0.397 }, { label: "Y", inch: 0.404 },
  { label: "13/32", inch: 0.40625 },
  { label: "Z", inch: 0.413 }, { label: "27/64", inch: 0.421875 },
  { label: "7/16", inch: 0.4375 }, { label: "29/64", inch: 0.453125 },
  { label: "15/32", inch: 0.46875 }, { label: "31/64", inch: 0.484375 },
  { label: "1/2", inch: 0.5 },
];

/**
 * Nearest standard drill, or null when nothing matches within `toleranceInch`.
 * Default tolerance is 0.0005" — half a thousandth, tighter than any shop drill
 * runs, so a match means the designer really did model a standard hole.
 */
export function drillDesignation(diameterMm: number, toleranceInch = 0.0005): string | null {
  if (!Number.isFinite(diameterMm) || diameterMm <= 0) return null;
  const inch = mmToInch(diameterMm);
  let best: { label: string; delta: number } | null = null;
  for (const size of DRILL_SIZES) {
    const delta = Math.abs(size.inch - inch);
    if (!best || delta < best.delta) best = { label: size.label, delta };
  }
  if (!best || best.delta > toleranceInch) return null;
  return best.label;
}

/**
 * Parse an Onshape quantity expression to millimetres.
 *
 * Onshape hands back strings like "0.5 in", "12.7 mm", "0.0127 m", or a bare
 * number (already metres, in the parameter payloads that carry `value`).
 * Anything with an unrecognised unit, a variable reference (`#length`), or
 * arithmetic returns null — an expression we cannot evaluate exactly is a
 * measurement we are not allowed to print.
 */
export function quantityToMm(expression: string | number | boolean | null | undefined): number | null {
  if (typeof expression === "number") {
    return Number.isFinite(expression) ? metresToMm(expression) : null;
  }
  if (typeof expression !== "string") return null;
  const text = expression.trim();
  if (!text) return null;
  const match = /^([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*(mm|cm|m|in|inch|ft|")?$/.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  switch ((match[2] ?? "m").toLowerCase()) {
    case "mm":
      return value;
    case "cm":
      return value * 10;
    case "m":
      return value * 1000;
    case "in":
    case "inch":
    case '"':
      return inchToMm(value);
    case "ft":
      return inchToMm(value * 12);
    default:
      return null;
  }
}

/** Imperial machine-screw threads FRC actually uses, with their tap drills. */
const UNIFIED_THREADS: Array<{ designation: string; majorInch: number; tapDrill: string }> = [
  { designation: "4-40", majorInch: 0.112, tapDrill: "#43" },
  { designation: "6-32", majorInch: 0.138, tapDrill: "#36" },
  { designation: "8-32", majorInch: 0.164, tapDrill: "#29" },
  { designation: "10-32", majorInch: 0.19, tapDrill: "#21" },
  { designation: "10-24", majorInch: 0.19, tapDrill: "#25" },
  { designation: "1/4-20", majorInch: 0.25, tapDrill: "#7" },
  { designation: "5/16-18", majorInch: 0.3125, tapDrill: "F" },
  { designation: "3/8-16", majorInch: 0.375, tapDrill: "5/16" },
];

/**
 * The tap drill for a thread designation Onshape actually named
 * ("#10-32", "M5x0.8"). Returns null for anything not in the table — the
 * manual then prints the thread and says the drill is not specified, rather
 * than inventing one.
 */
export function tapDrillFor(designation: string): string | null {
  const normalized = designation.replace(/^#/, "").replace(/\s+/g, "").toLowerCase();
  const hit = UNIFIED_THREADS.find(
    (thread) => thread.designation.toLowerCase() === normalized,
  );
  return hit?.tapDrill ?? null;
}

export function knownThreadDesignations(): string[] {
  return UNIFIED_THREADS.map((thread) => thread.designation);
}
