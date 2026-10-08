/** Pure planning contracts. A screenshot is context, never a source of scale. */
export type LengthUnit = "mm" | "cm" | "m" | "in" | "ft";
export type AngleUnit = "deg" | "rad";

const MILLIMETERS: Record<LengthUnit, number> = {
  mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8,
};
const QUANTITY = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*([a-z]+)$/i;

function explicitQuantity(input: string): { value: number; unit: string } {
  if (typeof input !== "string") throw new Error("Supply a value with explicit units.");
  const match = QUANTITY.exec(input.trim());
  if (!match) throw new Error(`Use an explicit value and unit, such as 25 mm or 90 deg: ${input}`);
  const value = Number(match[1]);
  if (!Number.isFinite(value)) throw new Error("The value must be finite.");
  return { value, unit: match[2]!.toLowerCase() };
}

export function parseLength(input: string): { millimeters: number; value: number; unit: LengthUnit } {
  const { value, unit } = explicitQuantity(input);
  if (!Object.hasOwn(MILLIMETERS, unit)) throw new Error("Length units must be mm, cm, m, in or ft.");
  const millimeters = value * MILLIMETERS[unit as LengthUnit];
  if (value <= 0 || !Number.isFinite(millimeters) || millimeters <= 0) {
    throw new Error("A dimension must be positive and finite.");
  }
  return { millimeters, value, unit: unit as LengthUnit };
}

export function parseAngle(input: string): { radians: number; value: number; unit: AngleUnit } {
  const { value, unit } = explicitQuantity(input);
  if (unit !== "deg" && unit !== "rad") throw new Error("Angle units must be deg or rad.");
  const radians = unit === "deg" ? value * (Math.PI / 180) : value;
  if (!Number.isFinite(radians)) throw new Error("An angle must be finite.");
  return { radians, value, unit };
}

/** Include units in every Onshape input; document defaults must not change geometry. */
export function formatOnshapeLength(input: string): string {
  return `${parseLength(input).millimeters} mm`;
}

export interface DrawingDimension {
  key: string;
  label: string;
  kind: "length" | "angle";
  /** Only explicit annotations or user-supplied dimensions can authorize geometry. */
  source?: "drawing_annotation" | "user";
  value?: string;
}

export type DrawingPlanReview = {
  status: "ready";
  dimensions: Array<{ key: string; input: string; kind: "length" | "angle" }>;
} | {
  status: "clarification";
  questions: Array<{ key: string; question: string }>;
};

/** The caller enumerates all required dimensions before any geometry operation. */
export function reviewDrawingPlan(requirements: readonly DrawingDimension[]): DrawingPlanReview {
  if (requirements.length === 0) {
    return { status: "clarification", questions: [{ key: "dimensions", question: "Which dimensions and units should define this part?" }] };
  }
  const keys = new Set<string>();
  const dimensions: Extract<DrawingPlanReview, { status: "ready" }>["dimensions"] = [];
  const questions: Extract<DrawingPlanReview, { status: "clarification" }>["questions"] = [];
  for (const dimension of requirements) {
    if (!dimension.key.trim() || !dimension.label.trim() || keys.has(dimension.key)) {
      throw new Error("Dimensions need unique keys and readable labels.");
    }
    keys.add(dimension.key);
    if (dimension.kind !== "length" && dimension.kind !== "angle") throw new Error("Unknown dimension kind.");
    if (!dimension.value || (dimension.source !== "drawing_annotation" && dimension.source !== "user")) {
      questions.push({ key: dimension.key, question: `What is ${dimension.label}, including units? I cannot infer it from image scale.` });
      continue;
    }
    try {
      let input: string;
      if (dimension.kind === "length") {
        input = formatOnshapeLength(dimension.value);
      } else {
        const angle = parseAngle(dimension.value);
        input = `${angle.value} ${angle.unit}`;
      }
      dimensions.push({ key: dimension.key, input, kind: dimension.kind });
    } catch {
      questions.push({ key: dimension.key, question: `Please provide ${dimension.label} with explicit ${dimension.kind === "length" ? "mm, cm, m, in or ft" : "deg or rad"} units.` });
    }
  }
  return questions.length ? { status: "clarification", questions } : { status: "ready", dimensions };
}

interface PhysicalEvidenceContext {
  /** Copy visible UI text rather than deriving physical properties from a picture. */
  source: "onshape_ui";
  observedText: string;
  material: string;
  /** For example: center of mass, aligned with the document coordinate system. */
  referenceFrame: string;
  /** Name the selected parts/assembly so a partial selection is not mistaken for the whole model. */
  selection: string;
}

export type PhysicalEvidence = PhysicalEvidenceContext & ({
  kind: "mass";
  value: number;
  unit: "kg" | "g" | "lb";
} | {
  kind: "inertia";
  unit: "kg*m^2" | "kg*mm^2" | "g*mm^2" | "lb*in^2";
  /** Preserve the displayed tensor and its convention; do not silently flip cross terms. */
  components: { xx: number; yy: number; zz: number; xy: number; xz: number; yz: number };
  convention: "inertia_tensor" | "products_of_inertia";
});

/** Checks completeness, not the truth of an observation. The UI must still be inspected. */
export function validatePhysicalEvidence(evidence: PhysicalEvidence): PhysicalEvidence {
  if (evidence.source !== "onshape_ui") throw new Error("Physical properties require observed Onshape UI evidence.");
  for (const field of ["observedText", "material", "referenceFrame", "selection"] as const) {
    if (typeof evidence[field] !== "string" || !evidence[field].trim()) throw new Error(`Physical evidence requires ${field}.`);
  }
  if (evidence.kind === "mass") {
    if (!["kg", "g", "lb"].includes(evidence.unit) || !Number.isFinite(evidence.value) || evidence.value <= 0) {
      throw new Error("Measured mass must be positive and finite, with supported units.");
    }
  } else if (evidence.kind === "inertia") {
    if (!["kg*m^2", "kg*mm^2", "g*mm^2", "lb*in^2"].includes(evidence.unit)) throw new Error("Inertia requires explicit supported units.");
    if (evidence.convention !== "inertia_tensor" && evidence.convention !== "products_of_inertia") throw new Error("Record the displayed inertia convention.");
    for (const key of ["xx", "yy", "zz", "xy", "xz", "yz"] as const) {
      if (!Number.isFinite(evidence.components?.[key])) throw new Error("All six inertia components must be finite.");
    }
    if ([evidence.components.xx, evidence.components.yy, evidence.components.zz].some((value) => value < 0)) {
      throw new Error("Diagonal inertia components cannot be negative.");
    }
  } else {
    throw new Error("Unknown physical property.");
  }
  return evidence;
}
