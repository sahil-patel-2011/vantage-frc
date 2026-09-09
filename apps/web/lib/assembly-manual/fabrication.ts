import {
  boxExtent,
  NOT_IN_CAD,
  type FabricationLine,
  type FeatureFacts,
  type PartFacts,
} from "./model";
import { drillDesignation, formatDiameterInches, formatInches, quantityToMm, tapDrillFor } from "./units";

/**
 * Turning CAD features into shop instructions — and refusing to when the CAD
 * does not say.
 *
 * This is the module the whole feature's credibility rests on. A manual that
 * tells a student to drill a #9 hole when the designer never specified a hole
 * size has not saved them time; it has cost them a part. So every line carries
 * `confirmed`, and an unconfirmed line prints "confirm — not specified in CAD"
 * as part of its own text, where no renderer can drop it.
 *
 * WHAT COUNTS AS SPECIFIED
 *
 *   length   the part has a bounding box (always a real measurement) AND an
 *            extrude feature whose depth matches it. Bounding box alone gives
 *            the modelled length, which is a fact about the model but not
 *            necessarily a cut instruction — a tube drawn at nominal 24" that
 *            nobody ever trimmed measures 24" and should be confirmed by a
 *            human, so that case is unconfirmed and says why.
 *   hole     a hole feature with a readable diameter expression. An extrude
 *            REMOVE that happens to be round is NOT a hole callout: we cannot
 *            read its diameter from the feature, so it becomes a note.
 *   thread   the hole feature says TAPPED and names a size. A diameter that
 *            merely happens to equal a tap drill is not a thread spec.
 */

function unconfirmed(text: string): string {
  return `${text} — ${NOT_IN_CAD}`;
}

function parameterMatching(
  feature: FeatureFacts,
  pattern: RegExp,
  prefer?: string,
): string | number | boolean | undefined {
  if (prefer && feature.parameters[prefer] !== undefined) return feature.parameters[prefer];
  for (const [key, value] of Object.entries(feature.parameters)) {
    if (pattern.test(key)) return value;
  }
  return undefined;
}

function placeCount(feature: FeatureFacts): number | null {
  for (const [key, value] of Object.entries(feature.parameters)) {
    if (!key.endsWith("__count")) continue;
    if (/location|position|point|sketch|face|entit/i.test(key) && typeof value === "number" && value > 0) {
      return value;
    }
  }
  return null;
}

const THREAD_PATTERN = /(#?\d+-\d+|\d\/\d+-\d+|M\d+(?:[x×]\d+(?:\.\d+)?)?)/i;

/** A thread designation Onshape actually wrote down, or null. */
export function threadDesignation(feature: FeatureFacts): string | null {
  const candidates = Object.entries(feature.parameters)
    .filter(([key]) => /size|designation|screw|thread|tap/i.test(key))
    .map(([, value]) => value)
    .filter((value): value is string => typeof value === "string");
  for (const candidate of candidates) {
    const match = THREAD_PATTERN.exec(candidate);
    if (match) return match[1]!.replace(/^#/, "");
  }
  return null;
}

export function isTapped(feature: FeatureFacts): boolean {
  return Object.entries(feature.parameters).some(
    ([key, value]) =>
      (typeof value === "string" && value.toUpperCase() === "TAPPED") ||
      (/tapped/i.test(key) && value === true),
  );
}

function isThrough(feature: FeatureFacts): boolean {
  return Object.values(feature.parameters).some(
    (value) => typeof value === "string" && value.toUpperCase() === "THROUGH",
  );
}

/**
 * Hole features for one part's Part Studio → drill and tap lines.
 *
 * Note the scope caveat: Onshape's feature tree is per Part Studio, not per
 * part. A studio holding three parts has one feature list, and a hole feature
 * does not tell us which part it landed in without a FeatureScript evaluation
 * we deliberately do not run (it is a write-shaped API call against a team's
 * live document). So a hole line is attributed to the studio, and where the
 * studio holds more than one part the line says so instead of implying it
 * belongs to this part alone.
 */
export function holeLines(features: FeatureFacts[], partsInStudio: number): FabricationLine[] {
  const lines: FabricationLine[] = [];
  const scopeSuffix =
    partsInStudio > 1
      ? ` (this Part Studio holds ${partsInStudio} parts; check which one the hole is in)`
      : "";

  for (const feature of features) {
    if (feature.suppressed) continue;
    if (!/^hole$/i.test(feature.featureType)) continue;

    const diameterMm = quantityToMm(parameterMatching(feature, /diameter/i, "holeDiameter") ?? null);
    const count = placeCount(feature);
    const places = count === null ? null : count;
    const depthMm = quantityToMm(parameterMatching(feature, /depth/i, "holeDepth") ?? null);
    const tapped = isTapped(feature);
    const designation = threadDesignation(feature);

    if (diameterMm === null) {
      lines.push({
        kind: "drill",
        text: unconfirmed(`"${feature.name}" is a hole feature with no diameter this reader could evaluate${scopeSuffix}`),
        confirmed: false,
        source: "feature",
        featureId: feature.id,
      });
      continue;
    }

    const designationText = drillDesignation(diameterMm);
    const through = isThrough(feature);
    const depthText = through ? "through" : depthMm !== null ? `${formatInches(depthMm)} deep` : null;
    const placeText = places !== null ? `, ${places} place${places === 1 ? "" : "s"}` : "";

    if (tapped && designation) {
      const tapDrill = tapDrillFor(designation);
      lines.push({
        kind: "tap",
        text: `Tap ${designation}${placeText}${scopeSuffix}${tapDrill ? ` (tap drill ${tapDrill})` : ""}`,
        confirmed: true,
        source: "feature",
        featureId: feature.id,
      });
      if (!tapDrill) {
        lines.push({
          kind: "tap",
          text: unconfirmed(`Tap drill for ${designation} is not in the reference table, so it is not stated here`),
          confirmed: false,
          source: "feature",
          featureId: feature.id,
        });
      }
      continue;
    }

    if (tapped && !designation) {
      lines.push({
        kind: "tap",
        text: unconfirmed(
          `"${feature.name}" is modelled as a tapped hole at ${formatDiameterInches(diameterMm)} but names no thread, so the thread is not stated here${scopeSuffix}`,
        ),
        confirmed: false,
        source: "feature",
        featureId: feature.id,
      });
      continue;
    }

    lines.push({
      kind: "drill",
      text:
        `Drill ${formatDiameterInches(diameterMm)}` +
        `${designationText ? ` (${designationText})` : ""}` +
        `${depthText ? ` ${depthText}` : ""}${placeText}${scopeSuffix}`,
      confirmed: true,
      source: "feature",
      featureId: feature.id,
    });
    if (places === null) {
      lines.push({
        kind: "drill",
        text: unconfirmed(`How many of "${feature.name}" there are is not readable from the feature`),
        confirmed: false,
        source: "feature",
        featureId: feature.id,
      });
    }
  }
  return lines;
}

/**
 * The stock line: what to cut, and how long.
 *
 * The length always comes from the bounding box, which Onshape measured. What
 * changes is whether we can call it a CUT: only when an extrude in the same
 * studio has a depth that matches the long dimension, meaning somebody actually
 * dimensioned the length rather than dropping in stock at its nominal size.
 */
export function cutLine(part: PartFacts, features: FeatureFacts[]): FabricationLine {
  if (!part.bboxMm) {
    return {
      kind: "cut",
      text: unconfirmed(`No bounding box for "${part.name}", so no length is stated`),
      confirmed: false,
      source: "boundingBox",
    };
  }
  const extents = boxExtent(part.bboxMm);
  const sorted = extents.slice().sort((a, b) => b - a) as [number, number, number];
  const [longest, mid, shortest] = sorted;
  const profile = `${formatInches(mid)} × ${formatInches(shortest)}`;

  const matchingExtrude = features.find((feature) => {
    if (feature.suppressed) return false;
    if (!/^extrude$/i.test(feature.featureType)) return false;
    const depthMm = quantityToMm(parameterMatching(feature, /depth|distance/i, "depth") ?? null);
    return depthMm !== null && Math.abs(depthMm - longest) <= 0.5;
  });

  if (matchingExtrude) {
    return {
      kind: "cut",
      text: `Cut ${profile} stock to ${formatInches(longest)}`,
      confirmed: true,
      source: "feature",
      featureId: matchingExtrude.id,
    };
  }
  return {
    kind: "cut",
    text: unconfirmed(
      `"${part.name}" measures ${formatInches(longest)} along its long axis (${profile} section) in CAD, but no feature sets that length`,
    ),
    confirmed: false,
    source: "boundingBox",
  };
}

export function materialLine(part: PartFacts): FabricationLine {
  if (part.material) {
    return { kind: "material", text: `Material: ${part.material}`, confirmed: true, source: "massProperties" };
  }
  return {
    kind: "material",
    text: unconfirmed(`"${part.name}" has no material assigned in CAD`),
    confirmed: false,
    source: "massProperties",
  };
}

/**
 * Cuts made by an extrude REMOVE that we cannot dimension. Reported as a note
 * so the reader knows material comes off there, without a made-up size.
 */
export function unspecifiedCutNotes(features: FeatureFacts[]): FabricationLine[] {
  return features
    .filter((feature) => {
      if (feature.suppressed) return false;
      if (!/^extrude$/i.test(feature.featureType)) return false;
      return Object.values(feature.parameters).some(
        (value) => typeof value === "string" && value.toUpperCase() === "REMOVE",
      );
    })
    .map((feature) => ({
      kind: "note" as const,
      text: unconfirmed(`"${feature.name}" removes material, and its size is not readable from the feature`),
      confirmed: false,
      source: "feature",
      featureId: feature.id,
    }));
}

export type FabricationInput = {
  part: PartFacts | null;
  /** Features belonging to the part's own Part Studio element. */
  features: FeatureFacts[];
  /** How many parts share that Part Studio. */
  partsInStudio: number;
  /** True when the instance was classified as hardware. */
  isFastener: boolean;
};

/**
 * Every fabrication line for one part, in the order a shop would do them:
 * material, cut, drill, tap, then notes.
 *
 * Hardware gets nothing: you do not machine a bolt, you fetch one. Emitting cut
 * lines for a purchased screw would be noise at best and wrong at worst.
 */
export function fabricationFor(input: FabricationInput): FabricationLine[] {
  if (!input.part) {
    return [
      {
        kind: "note",
        text: unconfirmed("Onshape did not resolve this instance to a part, so nothing about making it is stated"),
        confirmed: false,
        source: "assembly",
      },
    ];
  }
  if (input.isFastener) return [];

  const lines: FabricationLine[] = [materialLine(input.part), cutLine(input.part, input.features)];
  lines.push(...holeLines(input.features, input.partsInStudio));
  lines.push(...unspecifiedCutNotes(input.features));
  return lines;
}

export type CutListRow = {
  partName: string;
  material: string | null;
  quantity: number;
  /** Longest dimension in mm, from the bounding box. */
  lengthMm: number | null;
  profile: string | null;
  massKg: number | null;
  /** False when no feature sets the length — the row prints the caveat. */
  lengthConfirmed: boolean;
};

/**
 * The materials list that goes at the front of the book.
 *
 * One row per distinct part, with the count of how many the assembly uses.
 * Rows whose length is not set by a feature are marked, because a cut list is
 * exactly where an unconfirmed length does the most damage.
 */
export function buildCutList(
  parts: PartFacts[],
  instanceCountByPartKey: Map<string, number>,
  featuresByElement: Map<string, FeatureFacts[]>,
  fastenerPartKeys: Set<string>,
): CutListRow[] {
  return parts
    .filter((part) => !fastenerPartKeys.has(part.key))
    .map((part) => {
      const features = featuresByElement.get(part.elementId) ?? [];
      const cut = cutLine(part, features);
      const extents = part.bboxMm ? (boxExtent(part.bboxMm).slice().sort((a, b) => b - a) as [number, number, number]) : null;
      return {
        partName: part.name,
        material: part.material,
        quantity: instanceCountByPartKey.get(part.key) ?? 0,
        lengthMm: extents ? extents[0] : null,
        profile: extents ? `${formatInches(extents[1])} × ${formatInches(extents[2])}` : null,
        massKg: part.massKg,
        lengthConfirmed: cut.confirmed,
      };
    })
    .filter((row) => row.quantity > 0)
    .sort((a, b) => (b.lengthMm ?? 0) - (a.lengthMm ?? 0) || a.partName.localeCompare(b.partName));
}

/** The hardware table: purchased parts, counted, never dimensioned by us. */
export function buildHardwareList(
  parts: PartFacts[],
  instanceCountByPartKey: Map<string, number>,
  fastenerPartKeys: Set<string>,
): Array<{ partName: string; quantity: number; massKg: number | null }> {
  return parts
    .filter((part) => fastenerPartKeys.has(part.key))
    .map((part) => ({
      partName: part.name,
      quantity: instanceCountByPartKey.get(part.key) ?? 0,
      massKg: part.massKg,
    }))
    .filter((row) => row.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity || a.partName.localeCompare(b.partName));
}
