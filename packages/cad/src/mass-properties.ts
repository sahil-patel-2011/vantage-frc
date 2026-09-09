/**
 * Reading and comparing Onshape mass properties — the engine behind CAD lesson
 * auto-grading.
 *
 * WHAT IS GRADED, AND WHY ONLY TWO THINGS
 *
 * Mass and moment of inertia. Not centre of mass: Onshape's reported centre of
 * mass moves with where the part happens to sit relative to the Part Studio
 * origin, so two identical parts modelled on different planes report different
 * centroids. Grading on it would fail correct work, which is worse than not
 * grading it at all.
 *
 * Mass and the principal moments of inertia do not have that problem:
 *   - mass is a property of the solid alone;
 *   - PRINCIPAL moments are taken about the part's own centre of mass along its
 *     own principal axes, so they are invariant under translation and rotation.
 *     A student who built the same part upside-down on the Front plane gets the
 *     same three numbers.
 * That invariance is the whole reason this file insists on `principalInertia`
 * and refuses to grade MOI from the raw tensor: the tensor's frame is not
 * something we can verify from the response, and a wrong assumption there would
 * fail a correct part.
 *
 * MATERIAL
 *
 * Both parts must be on the SAME material or the comparison is meaningless —
 * mass and MOI are both linear in density, so a student on aluminium is off by
 * roughly a factor of three and the numbers say nothing about their geometry.
 * The track sets cast iron for every lesson. We do not hardcode a density to
 * check that: we derive mass/volume for BOTH parts from their own response and
 * compare them to each other. A density mismatch is then a real measurement,
 * not an assumption about what Onshape's material library contains.
 *
 * NEVER FABRICATE A GRADE
 *
 * Every read returns a discriminated result. If Onshape is not connected, the
 * document is not readable, the API errors, or the response has no mass, the
 * caller gets a typed failure with a reason — never a zero, never a default,
 * never a partial grade. `gradeMassProperties` cannot even be called without
 * two successfully-read parts.
 */

import type { OnshapeDocumentRef, OnshapeHttp } from "./onshape";

/** The material every lesson part is graded on. Stated in the UI and the lesson. */
export const CAD_LEARN_MATERIAL = "Cast iron";

/**
 * Tolerance bands, and the reasoning behind the numbers.
 *
 * MASS — Onshape computes mass analytically from the BRep volume times the
 * material density, so there is no tessellation error in the number itself.
 * What does move it legitimately:
 *   - a dimension typed in the wrong unit and corrected by eye (small residue),
 *   - a fillet or chamfer at a slightly different size,
 *   - rounding in a density value if a material was re-created by hand.
 * Half a percent covers all of that. Two percent is where "close enough to be
 * a rounding difference" stops and "you built something else" starts.
 *
 * MOI — moment of inertia goes as mass times distance squared, so the SAME
 * relative dimension error shows up roughly twice as large in MOI as in mass.
 * The band is widened to match: a part within 0.5% on mass will typically land
 * within about 1-2% on MOI, so 2% is the equivalent bar and 5% the equivalent
 * of the mass 2% line.
 *
 * These are teaching thresholds, not inspection thresholds. Being outside them
 * is a prompt to go and look at a specific thing, which is why every result
 * carries `whatToCheck`.
 */
export const CAD_GRADE_TOLERANCE = {
  mass: { match: 0.5, close: 2 },
  momentOfInertia: { match: 2, close: 5 },
  /** Above this, the two parts are not on the same material. */
  densityMismatchPercent: 1,
} as const;

export type CadGradeBand = "match" | "close" | "off";

export type PartMassProperties = {
  /** kg. Onshape reports SI regardless of the document's display units. */
  massKg: number;
  /** m^3, when the response carries it. Needed for the density cross-check. */
  volumeM3: number | null;
  /** kg·m^2, ascending. About the part's own centre of mass. */
  principalInertiaKgM2: [number, number, number] | null;
  /** kg/m^3, derived from this part's own mass and volume. */
  densityKgM3: number | null;
  /** Which entry of `bodies` this came from ("-all-" for the whole studio). */
  bodyKey: string;
  microversionId: string | null;
};

export type MassPropertiesFailureReason =
  | "not_connected"
  | "no_access"
  | "api_error"
  | "no_mass"
  | "unreadable";

export type MassPropertiesRead =
  | { ok: true; value: PartMassProperties }
  | {
      ok: false;
      reason: MassPropertiesFailureReason;
      /** Shown to the student verbatim. Says what failed and what to do. */
      message: string;
      /** HTTP status when the failure came from Onshape. */
      status?: number;
    };

/**
 * Onshape returns most scalars as [value, min, max] and some as plain numbers.
 * Anything else (null, a string, an empty array) is not a number we may use.
 */
function scalar(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0];
    if (typeof first === "number" && Number.isFinite(first)) return first;
  }
  return null;
}

/**
 * `principalInertia` is three numbers. Sorted ascending so the comparison does
 * not depend on which axis Onshape happened to call first — the ordering is
 * arbitrary between two parts that are geometrically identical.
 */
function principalInertia(raw: unknown): [number, number, number] | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const values = raw.slice(0, 3).map((entry) => scalar(entry));
  if (values.some((value) => value === null)) return null;
  const numbers = (values as number[]).slice().sort((a, b) => a - b);
  // A solid part has three strictly positive principal moments. Zeros mean the
  // response described something without mass (a surface, an empty studio).
  if (numbers.some((value) => !(value > 0))) return null;
  return [numbers[0]!, numbers[1]!, numbers[2]!];
}

/**
 * Pull the numbers out of an Onshape `/massproperties` payload.
 *
 * Prefers the `-all-` aggregate (every solid in the Part Studio), because a
 * lesson part is one Part Studio and that is what the student sees in the mass
 * properties panel. Falls back to the single body when a studio holds exactly
 * one, so a response shaped per-part still grades.
 */
export function parseOnshapeMassProperties(body: unknown): MassPropertiesRead {
  if (!body || typeof body !== "object") {
    return { ok: false, reason: "unreadable", message: "Onshape returned something that was not a mass-properties response." };
  }
  const payload = body as Record<string, unknown>;
  const bodies = payload.bodies;
  if (!bodies || typeof bodies !== "object") {
    return {
      ok: false,
      reason: "unreadable",
      message: "Onshape's response had no bodies in it. Open the Part Studio and check the part actually exists.",
    };
  }
  const table = bodies as Record<string, unknown>;
  const keys = Object.keys(table);
  const bodyKey = keys.includes("-all-") ? "-all-" : (keys.find((key) => table[key] && typeof table[key] === "object") ?? "");
  const entry = bodyKey ? (table[bodyKey] as Record<string, unknown>) : null;
  if (!entry) {
    return {
      ok: false,
      reason: "no_mass",
      message: "That Part Studio has no solid body with mass yet. Finish the part, then link it again.",
    };
  }

  const massKg = scalar(entry.mass);
  if (massKg === null || !(massKg > 0)) {
    // hasMass:false is Onshape's way of saying "no material is assigned".
    const noMaterial = entry.hasMass === false;
    return {
      ok: false,
      reason: "no_mass",
      message: noMaterial
        ? `That part has no material assigned, so Onshape reports no mass. Assign ${CAD_LEARN_MATERIAL} to the part and try again.`
        : `Onshape reported no usable mass for that part. Check the part is a solid and that ${CAD_LEARN_MATERIAL} is assigned.`,
    };
  }

  const volumeM3 = scalar(entry.volume);
  const inertia = principalInertia(entry.principalInertia);
  const density = volumeM3 !== null && volumeM3 > 0 ? massKg / volumeM3 : null;

  return {
    ok: true,
    value: {
      massKg,
      volumeM3: volumeM3 !== null && volumeM3 > 0 ? volumeM3 : null,
      principalInertiaKgM2: inertia,
      densityKgM3: density,
      bodyKey: bodyKey || "-all-",
      microversionId: typeof payload.microversionId === "string" ? payload.microversionId : null,
    },
  };
}

/**
 * Read mass properties for one Part Studio over the caller's own OAuth token.
 *
 * Deliberately returns failures rather than throwing: the grader's contract is
 * that it says exactly why it could not read, and grades nothing. A thrown
 * error at this layer would be caught somewhere generic and turned into a
 * shrug.
 */
export async function readOnshapeMassProperties(
  http: OnshapeHttp,
  document: OnshapeDocumentRef,
): Promise<MassPropertiesRead> {
  const path = `/partstudios/d/${document.documentId}/w/${document.workspaceId}/e/${document.elementId}/massproperties`;
  let response: Response;
  try {
    response = await http(path);
  } catch {
    return {
      ok: false,
      reason: "api_error",
      message: "Could not reach Onshape. Check your connection and try again — nothing was graded.",
    };
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        reason: "no_access",
        status: response.status,
        message:
          "Onshape refused access to that document. Either your Vantage connection needs reconnecting, or the document is not shared with your Onshape account. Nothing was graded.",
      };
    }
    if (response.status === 404) {
      return {
        ok: false,
        reason: "no_access",
        status: 404,
        message:
          "Onshape could not find that Part Studio. Paste the link from the Part Studio tab itself (.../w/<workspace>/e/<element>). Nothing was graded.",
      };
    }
    return {
      ok: false,
      reason: "api_error",
      status: response.status,
      message: `Onshape returned ${response.status} for the mass-properties request. Nothing was graded.`,
    };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, reason: "unreadable", message: "Onshape's mass-properties response could not be read as JSON. Nothing was graded." };
  }
  return parseOnshapeMassProperties(json);
}

/** Signed: positive means the student's part is larger than the reference. */
export function percentDifference(student: number, reference: number): number | null {
  if (!Number.isFinite(student) || !Number.isFinite(reference) || reference === 0) return null;
  return ((student - reference) / reference) * 100;
}

/**
 * The epsilon is not cosmetic. A part exactly 2% out computes as
 * 2.0000000000000018 in IEEE 754, and without slack that student is told their
 * work is "off" by a rounding artefact of the division. On a boundary, the
 * more generous band wins.
 */
function bandFor(absPercent: number, limits: { match: number; close: number }): CadGradeBand {
  const epsilon = 1e-9;
  if (absPercent <= limits.match + epsilon) return "match";
  if (absPercent <= limits.close + epsilon) return "close";
  return "off";
}

export type CadGradeFactor = {
  id: "mass" | "moment_of_inertia";
  label: string;
  unit: string;
  reference: number;
  student: number;
  /** Signed percentage against the reference. */
  percentDifference: number;
  band: CadGradeBand;
};

export type CadGradeResult = {
  /** Always true here — a failed read never reaches this type. */
  graded: true;
  material: string;
  overall: CadGradeBand;
  factors: CadGradeFactor[];
  /**
   * Per-principal-axis MOI differences, ascending. The headline MOI number is
   * the worst of these; showing all three is what turns "8% off" into "two
   * axes match and the third does not", which points at a specific mistake.
   */
  perAxisInertiaPercent: number[] | null;
  /** Why MOI is missing, when it is. Null when MOI was graded. */
  inertiaUngradedReason: string | null;
  densityCheck: {
    referenceKgM3: number;
    studentKgM3: number;
    percentDifference: number;
    sameMaterial: boolean;
  } | null;
  /** Concrete things to go and look at. Always non-empty. */
  whatToCheck: string[];
};

/**
 * Compare a student's part against the reference part.
 *
 * Both inputs are successful reads, so this function never has to invent a
 * number. Where MOI cannot be compared (either part's response had no principal
 * moments) it says so and grades mass only — it does not quietly score MOI as
 * perfect, which is how a grader ends up rewarding a part it never measured.
 */
export function gradeMassProperties(input: {
  reference: PartMassProperties;
  student: PartMassProperties;
}): CadGradeResult {
  const { reference, student } = input;
  const factors: CadGradeFactor[] = [];

  const massPercent = percentDifference(student.massKg, reference.massKg);
  const massBand: CadGradeBand = massPercent === null ? "off" : bandFor(Math.abs(massPercent), CAD_GRADE_TOLERANCE.mass);
  factors.push({
    id: "mass",
    label: "Mass",
    unit: "kg",
    reference: reference.massKg,
    student: student.massKg,
    percentDifference: massPercent ?? 0,
    band: massBand,
  });

  let perAxisInertiaPercent: number[] | null = null;
  let inertiaUngradedReason: string | null = null;
  if (reference.principalInertiaKgM2 && student.principalInertiaKgM2) {
    const perAxis = reference.principalInertiaKgM2.map((referenceAxis, index) => {
      const studentAxis = student.principalInertiaKgM2![index]!;
      return percentDifference(studentAxis, referenceAxis) ?? 0;
    });
    perAxisInertiaPercent = perAxis;
    // The headline is the worst axis. An average would hide a part that is
    // right in two directions and wrong in the third, which is the single most
    // common real mistake (a feature placed on the wrong side).
    let worstIndex = 0;
    for (let index = 1; index < perAxis.length; index += 1) {
      if (Math.abs(perAxis[index]!) > Math.abs(perAxis[worstIndex]!)) worstIndex = index;
    }
    const worst = perAxis[worstIndex]!;
    const referenceWorst = reference.principalInertiaKgM2[worstIndex]!;
    const studentWorst = student.principalInertiaKgM2[worstIndex]!;
    factors.push({
      id: "moment_of_inertia",
      label: "Moment of inertia (worst principal axis)",
      unit: "kg·m²",
      reference: referenceWorst,
      student: studentWorst,
      percentDifference: worst,
      band: bandFor(Math.abs(worst), CAD_GRADE_TOLERANCE.momentOfInertia),
    });
  } else {
    inertiaUngradedReason = !reference.principalInertiaKgM2
      ? "The reference part's Onshape response carried no principal moments of inertia, so MOI was not graded. Mass was."
      : "Onshape returned no principal moments of inertia for your part, so MOI was not graded. Mass was. This usually means the Part Studio has no solid body with a material assigned.";
  }

  let densityCheck: CadGradeResult["densityCheck"] = null;
  if (reference.densityKgM3 !== null && student.densityKgM3 !== null) {
    const difference = percentDifference(student.densityKgM3, reference.densityKgM3) ?? 0;
    densityCheck = {
      referenceKgM3: reference.densityKgM3,
      studentKgM3: student.densityKgM3,
      percentDifference: difference,
      sameMaterial: Math.abs(difference) <= CAD_GRADE_TOLERANCE.densityMismatchPercent,
    };
  }

  const bands = factors.map((factor) => factor.band);
  const overall: CadGradeBand = bands.includes("off") ? "off" : bands.includes("close") ? "close" : "match";

  return {
    graded: true,
    material: CAD_LEARN_MATERIAL,
    overall,
    factors,
    perAxisInertiaPercent,
    inertiaUngradedReason,
    densityCheck,
    whatToCheck: explainGrade({ factors, densityCheck, inertiaUngradedReason, perAxisInertiaPercent }),
  };
}

/**
 * Turn the two percentages into things to go and look at.
 *
 * This is the part that makes it a teaching tool rather than a pass/fail gate.
 * The rules come from how the two numbers move together, and the physics is
 * what makes the ratio diagnostic:
 *   - scale one thickness by (1+e): mass and the moment about that axis both
 *     scale by (1+e), so MOI% / mass% is about 1;
 *   - change density by (1+e): both scale by (1+e) too, ratio about 1 again —
 *     which is why the density cross-check runs FIRST and returns early. Once
 *     the densities are known to match, a ratio near 1 means thickness;
 *   - scale the whole part by (1+e): mass goes as the cube and MOI as the
 *     fifth power, so MOI% / mass% tends to 5/3. Anything above ~1.4 means
 *     material has moved outward, not just got thicker.
 */
function explainGrade(input: {
  factors: CadGradeFactor[];
  densityCheck: CadGradeResult["densityCheck"];
  inertiaUngradedReason: string | null;
  perAxisInertiaPercent: number[] | null;
}): string[] {
  const notes: string[] = [];
  const mass = input.factors.find((factor) => factor.id === "mass");
  const inertia = input.factors.find((factor) => factor.id === "moment_of_inertia");

  if (input.densityCheck && !input.densityCheck.sameMaterial) {
    notes.push(
      `Your part and the reference are not on the same material — density differs by ${input.densityCheck.percentDifference.toFixed(1)}%. Set the part material to ${CAD_LEARN_MATERIAL} (right-click the part in the Parts list, Assign material) and grade again. Until the materials match, neither number means anything about your geometry.`,
    );
    return notes;
  }

  if (mass && mass.band === "match" && inertia && inertia.band === "match") {
    notes.push("Both numbers are inside tolerance. Your part matches the reference on mass and on how that mass is distributed.");
    return notes;
  }

  if (mass && mass.band !== "match") {
    const direction = mass.percentDifference > 0 ? "heavier" : "lighter";
    notes.push(
      `Mass is ${Math.abs(mass.percentDifference).toFixed(1)}% ${direction} than the reference. Check the dimensions the lesson gave you first — a single value typed in the wrong unit (mm vs in) is the usual cause, and it is easy to miss because the part still looks right.`,
    );
  }

  if (mass && inertia) {
    const massAbs = Math.abs(mass.percentDifference);
    const inertiaAbs = Math.abs(inertia.percentDifference);
    if (massAbs > CAD_GRADE_TOLERANCE.mass.match && inertiaAbs > CAD_GRADE_TOLERANCE.momentOfInertia.match) {
      const ratio = massAbs > 0 ? inertiaAbs / massAbs : 0;
      if (ratio > 0.7 && ratio < 1.4) {
        notes.push(
          input.densityCheck?.sameMaterial
            ? "Mass and MOI are off by about the same proportion, and the densities match — so the material is right and one thickness is wrong. Check the extrude depth, or a wall thickness, before you look anywhere else."
            : `Mass and MOI are off by about the same proportion. That happens when either the density or one thickness is wrong, and Onshape did not return a volume here so the two cannot be told apart automatically. Confirm the part material is ${CAD_LEARN_MATERIAL}, then check the extrude depth.`,
        );
      } else if (ratio >= 1.4) {
        notes.push(
          "MOI is off by proportionally more than mass. That means material has moved outward from the part's own axis — check the overall footprint dimensions and the position of any holes, bosses or cutouts, rather than the thickness.",
        );
      }
    } else if (massAbs <= CAD_GRADE_TOLERANCE.mass.match && inertiaAbs > CAD_GRADE_TOLERANCE.momentOfInertia.match) {
      notes.push(
        "Mass matches but MOI does not: you have the right amount of material in the wrong place. Look for a feature on the wrong side of a plane, a mirrored pattern, or a hole at the wrong distance from the centre.",
      );
    } else if (massAbs > CAD_GRADE_TOLERANCE.mass.close && inertiaAbs <= CAD_GRADE_TOLERANCE.momentOfInertia.match) {
      notes.push(
        "MOI matches but mass does not, which is unusual — the shape is right and the amount of material is not. Check the extrude depth or thickness, the one dimension that changes mass without changing the outline.",
      );
    }
  }

  if (input.perAxisInertiaPercent && input.perAxisInertiaPercent.length === 3) {
    const [a, b, c] = input.perAxisInertiaPercent as [number, number, number];
    const withinTolerance = [a, b, c].filter((value) => Math.abs(value) <= CAD_GRADE_TOLERANCE.momentOfInertia.match).length;
    if (withinTolerance === 2) {
      notes.push(
        "Two of the three principal axes match and one does not. That points at a single feature in the wrong place rather than a size problem across the whole part.",
      );
    }
  }

  if (input.inertiaUngradedReason) notes.push(input.inertiaUngradedReason);

  if (notes.length === 0) {
    notes.push(
      "Both numbers are within the wider band but outside an exact match. That is usually a fillet or chamfer at a slightly different size — compare your feature list against the lesson's dimensions.",
    );
  }
  return notes;
}
