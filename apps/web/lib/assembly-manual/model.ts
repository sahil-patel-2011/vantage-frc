/**
 * The shared vocabulary of the assembly manual engine.
 *
 * Every type in here describes something that came out of CAD. There is no
 * "estimated" or "typical" field anywhere: a value is either a number Onshape
 * reported, or `null` — and `null` is rendered as "confirm — not specified in
 * CAD", never filled in.
 */

export type Vec3 = [number, number, number];

/** Axis-aligned box in millimetres, in the assembly's own coordinate frame. */
export type BoxMm = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

export type PartFacts = {
  /** documentId:elementId:partId — unique across the whole assembly. */
  key: string;
  documentId: string;
  /** "w" for a team, "m" for a linked document's microversion. */
  wvm: "w" | "m" | "v";
  /** Workspace or microversion id, matching `wvm`. */
  workspaceId: string;
  /** Part Studio element the part lives in. */
  elementId: string;
  partId: string;
  name: string;
  /** Onshape material name, when the part has one assigned. */
  material: string | null;
  massKg: number | null;
  volumeM3: number | null;
  /** Part-local bounding box. Null when Onshape would not report one. */
  bboxMm: BoxMm | null;
};

export type InstanceFacts = {
  /** Occurrence id (the instance id inside the root assembly). */
  id: string;
  name: string;
  kind: "part" | "assembly" | "unknown";
  /** Null for sub-assembly instances and for anything Onshape did not resolve. */
  partKey: string | null;
  /** World-space axis-aligned box, derived from the part box and the occurrence
   *  transform. Null when either input was missing. */
  worldBoxMm: BoxMm | null;
  massKg: number | null;
  /** True when Onshape reports the occurrence as hidden in the design. */
  hidden: boolean;
};

export type MateFacts = {
  id: string;
  name: string;
  /** FASTENED / REVOLUTE / SLIDER / CYLINDRICAL / PLANAR / BALL / PIN_SLOT / PARALLEL. */
  mateType: string;
  /** Instance ids this mate joins, in the order Onshape listed them. */
  instanceIds: string[];
};

export type FeatureFacts = {
  /** Part Studio element the feature belongs to. */
  elementId: string;
  id: string;
  name: string;
  featureType: string;
  suppressed: boolean;
  /**
   * Flattened `parameterId -> value` map. Quantities keep their Onshape
   * expression string ("0.196 in"), enums keep their enum value ("REMOVE").
   * Anything we could not flatten is simply absent — never defaulted.
   */
  parameters: Record<string, string | number | boolean>;
};

export type AssemblyFacts = {
  documentId: string;
  workspaceId: string;
  elementId: string;
  name: string;
  parts: PartFacts[];
  instances: InstanceFacts[];
  mates: MateFacts[];
  features: FeatureFacts[];
  /** Things Onshape could not tell us. Surfaced verbatim in the run report. */
  gaps: string[];
};

export type FabricationLine = {
  kind: "cut" | "drill" | "tap" | "material" | "note";
  text: string;
  /**
   * False means "confirm — not specified in CAD". The UI and the PDF both print
   * that phrase; there is no path that drops the flag and prints the line as if
   * it were certain.
   */
  confirmed: boolean;
  /** The CAD fact this came from: a feature id, "boundingBox", or "massProperties". */
  source: string;
  featureId?: string;
};

export type StepPart = {
  instanceId: string;
  partKey: string | null;
  name: string;
  quantity: number;
  massKg: number | null;
  /** [x, y, z] extent in mm, longest first. Null when no box was available. */
  extentMm: Vec3 | null;
  cots: { name: string; vendor: string; sku: string } | null;
};

export type FeasibilityCheck = {
  id: string;
  passed: boolean;
  detail: string;
};

export type ManualStep = {
  stepNumber: number;
  subassembly: string;
  title: string;
  sentence: string;
  sentenceSource: "model" | "deterministic";
  parts: StepPart[];
  fabrication: FabricationLine[];
  feasibility: {
    prerequisites: string[];
    checks: FeasibilityCheck[];
    notes: string[];
  };
  disagreement: { otherPosition: number; strategy: string; note: string } | null;
};

export const NOT_IN_CAD = "confirm — not specified in CAD";

export function boxExtent(box: BoxMm): Vec3 {
  return [box.maxX - box.minX, box.maxY - box.minY, box.maxZ - box.minZ];
}

export function boxVolume(box: BoxMm): number {
  const [x, y, z] = boxExtent(box);
  return Math.max(0, x) * Math.max(0, y) * Math.max(0, z);
}

/** True when `inner` sits entirely inside `outer`, allowing `slackMm` of slop. */
export function boxContains(outer: BoxMm, inner: BoxMm, slackMm = 0): boolean {
  return (
    inner.minX >= outer.minX - slackMm &&
    inner.minY >= outer.minY - slackMm &&
    inner.minZ >= outer.minZ - slackMm &&
    inner.maxX <= outer.maxX + slackMm &&
    inner.maxY <= outer.maxY + slackMm &&
    inner.maxZ <= outer.maxZ + slackMm
  );
}

export function boxesOverlap(a: BoxMm, b: BoxMm, slackMm = 0): boolean {
  return (
    a.minX - slackMm < b.maxX &&
    b.minX - slackMm < a.maxX &&
    a.minY - slackMm < b.maxY &&
    b.minY - slackMm < a.maxY &&
    a.minZ - slackMm < b.maxZ &&
    b.minZ - slackMm < a.maxZ
  );
}

export function unionBox(boxes: BoxMm[]): BoxMm | null {
  const usable = boxes.filter(Boolean);
  if (!usable.length) return null;
  const first = usable[0]!;
  return usable.slice(1).reduce<BoxMm>(
    (acc, box) => ({
      minX: Math.min(acc.minX, box.minX),
      minY: Math.min(acc.minY, box.minY),
      minZ: Math.min(acc.minZ, box.minZ),
      maxX: Math.max(acc.maxX, box.maxX),
      maxY: Math.max(acc.maxY, box.maxY),
      maxZ: Math.max(acc.maxZ, box.maxZ),
    }),
    { ...first },
  );
}
