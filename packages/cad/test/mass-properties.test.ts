import { describe, expect, it } from "vitest";
import {
  CAD_GRADE_TOLERANCE,
  CAD_LEARN_MATERIAL,
  gradeMassProperties,
  parseOnshapeMassProperties,
  percentDifference,
  readOnshapeMassProperties,
  type PartMassProperties,
} from "../src/mass-properties";
import type { OnshapeHttp } from "../src/onshape";

const DOCUMENT = { documentId: "doc", workspaceId: "ws", elementId: "el" };

/** The shape Onshape actually returns: scalars as [value, min, max]. */
function onshapeBody(input: {
  mass: number;
  volume?: number;
  principalInertia?: [number, number, number] | null;
  hasMass?: boolean;
}) {
  const body: Record<string, unknown> = {
    mass: [input.mass, input.mass, input.mass],
    hasMass: input.hasMass ?? true,
  };
  if (input.volume !== undefined) body.volume = [input.volume, input.volume, input.volume];
  if (input.principalInertia !== null && input.principalInertia !== undefined) {
    body.principalInertia = input.principalInertia;
  }
  return { bodies: { "-all-": body }, microversionId: "mv1" };
}

function part(overrides: Partial<PartMassProperties> = {}): PartMassProperties {
  return {
    massKg: 1,
    volumeM3: 1 / 7200,
    principalInertiaKgM2: [0.001, 0.002, 0.003],
    densityKgM3: 7200,
    bodyKey: "-all-",
    microversionId: null,
    ...overrides,
  };
}

function scaledInertia(base: [number, number, number], factor: number): [number, number, number] {
  return [base[0] * factor, base[1] * factor, base[2] * factor];
}

describe("parsing an Onshape mass-properties response", () => {
  it("reads mass, volume and principal inertia out of the [value,min,max] shape", () => {
    const read = parseOnshapeMassProperties(
      onshapeBody({ mass: 0.72, volume: 0.0001, principalInertia: [0.003, 0.001, 0.002] }),
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.massKg).toBeCloseTo(0.72);
    expect(read.value.volumeM3).toBeCloseTo(0.0001);
    // Sorted ascending: Onshape's axis ordering is arbitrary between two parts
    // that are geometrically identical, so the comparison must not depend on it.
    expect(read.value.principalInertiaKgM2).toEqual([0.001, 0.002, 0.003]);
    expect(read.value.densityKgM3).toBeCloseTo(7200, 0);
    expect(read.value.microversionId).toBe("mv1");
  });

  it("accepts plain numbers as well as triples", () => {
    const read = parseOnshapeMassProperties({
      bodies: { "-all-": { mass: 2, volume: 0.5, principalInertia: [1, 2, 3], hasMass: true } },
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.massKg).toBe(2);
    expect(read.value.densityKgM3).toBe(4);
  });

  it("says a part has no material rather than grading it as weightless", () => {
    const read = parseOnshapeMassProperties({ bodies: { "-all-": { mass: [0, 0, 0], hasMass: false } } });
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toBe("no_mass");
    expect(read.message).toContain(CAD_LEARN_MATERIAL);
  });

  it("refuses a response with no bodies instead of inventing zeros", () => {
    for (const payload of [null, "nope", {}, { bodies: null }]) {
      const read = parseOnshapeMassProperties(payload);
      expect(read.ok, JSON.stringify(payload)).toBe(false);
    }
  });

  it("drops principal inertia that is not three positive numbers", () => {
    const read = parseOnshapeMassProperties(
      onshapeBody({ mass: 1, volume: 1, principalInertia: [0, 1, 2] }),
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.principalInertiaKgM2).toBeNull();
  });

  it("falls back to the single body when there is no -all- aggregate", () => {
    const read = parseOnshapeMassProperties({
      bodies: { JHD: { mass: [3, 3, 3], hasMass: true } },
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.bodyKey).toBe("JHD");
  });
});

describe("reading mass properties over OAuth", () => {
  it("hits the Part Studio massproperties endpoint", async () => {
    const calls: string[] = [];
    const http: OnshapeHttp = async (path) => {
      calls.push(path);
      return new Response(JSON.stringify(onshapeBody({ mass: 1, volume: 1, principalInertia: [1, 2, 3] })), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const read = await readOnshapeMassProperties(http, DOCUMENT);
    expect(read.ok).toBe(true);
    expect(calls[0]).toBe("/partstudios/d/doc/w/ws/e/el/massproperties");
  });

  // The whole point of the grader's contract: when it cannot measure, it says
  // so and grades nothing. A silently-defaulted zero here is exactly the
  // fabricated metric CLAUDE.md forbids.
  it.each([
    [401, "no_access"],
    [403, "no_access"],
    [404, "no_access"],
    [500, "api_error"],
  ])("reports %i as a typed failure and never a grade", async (status, reason) => {
    const http: OnshapeHttp = async () => new Response("{}", { status });
    const read = await readOnshapeMassProperties(http, DOCUMENT);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toBe(reason);
    expect(read.status).toBe(status);
    expect(read.message.toLowerCase()).toContain("nothing was graded");
  });

  it("reports a network failure rather than throwing", async () => {
    const http: OnshapeHttp = async () => {
      throw new Error("ECONNREFUSED");
    };
    const read = await readOnshapeMassProperties(http, DOCUMENT);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toBe("api_error");
  });

  it("reports an unreadable body rather than throwing", async () => {
    const http: OnshapeHttp = async () => new Response("not json", { status: 200 });
    const read = await readOnshapeMassProperties(http, DOCUMENT);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toBe("unreadable");
  });
});

describe("percentage difference", () => {
  it("is signed against the reference", () => {
    expect(percentDifference(110, 100)).toBeCloseTo(10);
    expect(percentDifference(90, 100)).toBeCloseTo(-10);
  });

  it("refuses to divide by a zero reference", () => {
    expect(percentDifference(1, 0)).toBeNull();
  });
});

describe("grading a student part", () => {
  it("grades an identical part as a match on both factors", () => {
    const result = gradeMassProperties({ reference: part(), student: part() });
    expect(result.overall).toBe("match");
    expect(result.factors.map((factor) => factor.id)).toEqual(["mass", "moment_of_inertia"]);
    expect(result.factors.every((factor) => factor.percentDifference === 0)).toBe(true);
    expect(result.material).toBe(CAD_LEARN_MATERIAL);
    expect(result.whatToCheck.length).toBeGreaterThan(0);
  });

  it("grades exactly two factors and never a centre of mass", () => {
    // The product owner corrected an early "mass, COM and MOI" spec: Onshape's
    // reported centre of mass moves with where the part sits, so grading on it
    // fails correct work. Pinned so it cannot come back.
    const result = gradeMassProperties({ reference: part(), student: part() });
    expect(result.factors).toHaveLength(2);
    expect(JSON.stringify(result).toLowerCase()).not.toContain("centroid");
    expect(JSON.stringify(result).toLowerCase()).not.toContain("center of mass");
    expect(JSON.stringify(result).toLowerCase()).not.toContain("centre of mass");
  });

  it("keeps a small legitimate difference inside the match band", () => {
    const student = part({ massKg: 1.004, principalInertiaKgM2: scaledInertia([0.001, 0.002, 0.003], 1.01) });
    const result = gradeMassProperties({ reference: part(), student });
    expect(result.overall).toBe("match");
  });

  it("calls a two percent mass error close, not a failure", () => {
    const student = part({ massKg: 1.02, densityKgM3: 7200 * 1.0, volumeM3: 1.02 / 7200 });
    const result = gradeMassProperties({ reference: part(), student });
    const mass = result.factors.find((factor) => factor.id === "mass")!;
    expect(mass.band).toBe("close");
    expect(mass.percentDifference).toBeCloseTo(2, 5);
  });

  it("calls a large error off and says which way", () => {
    const student = part({ massKg: 1.4, volumeM3: 1.4 / 7200 });
    const result = gradeMassProperties({ reference: part(), student });
    expect(result.overall).toBe("off");
    expect(result.whatToCheck.join(" ")).toContain("heavier");
  });

  it("uses the worst principal axis, not an average that hides one bad axis", () => {
    // Two axes perfect, one 10% out. An average would report 3.3% and pass.
    const student = part({ principalInertiaKgM2: [0.001, 0.002, 0.0033] });
    const result = gradeMassProperties({ reference: part(), student });
    const inertia = result.factors.find((factor) => factor.id === "moment_of_inertia")!;
    expect(inertia.percentDifference).toBeCloseTo(10, 5);
    expect(inertia.band).toBe("off");
    expect(result.perAxisInertiaPercent).toHaveLength(3);
    expect(result.whatToCheck.join(" ")).toContain("Two of the three principal axes match");
  });

  it("blames the material when the densities disagree, and stops there", () => {
    // Aluminium instead of cast iron: both numbers are wrong by the same large
    // factor and say nothing about the geometry, so the only useful advice is
    // "fix the material".
    const student = part({ massKg: 0.375, volumeM3: 1 / 7200, densityKgM3: 2700, principalInertiaKgM2: scaledInertia([0.001, 0.002, 0.003], 0.375) });
    const result = gradeMassProperties({ reference: part(), student });
    expect(result.densityCheck?.sameMaterial).toBe(false);
    expect(result.whatToCheck).toHaveLength(1);
    expect(result.whatToCheck[0]).toContain(CAD_LEARN_MATERIAL);
  });

  it("points at a thickness when mass and MOI move together on the same material", () => {
    const factor = 1.05;
    const student = part({
      massKg: factor,
      volumeM3: factor / 7200,
      densityKgM3: 7200,
      principalInertiaKgM2: scaledInertia([0.001, 0.002, 0.003], factor),
    });
    const result = gradeMassProperties({ reference: part(), student });
    expect(result.densityCheck?.sameMaterial).toBe(true);
    expect(result.whatToCheck.join(" ")).toContain("extrude depth");
  });

  it("points at where the material sits when mass matches but MOI does not", () => {
    const student = part({ principalInertiaKgM2: scaledInertia([0.001, 0.002, 0.003], 1.2) });
    const result = gradeMassProperties({ reference: part(), student });
    expect(result.whatToCheck.join(" ")).toContain("right amount of material in the wrong place");
  });

  it("grades mass only, and says so, when MOI cannot be read", () => {
    const student = part({ principalInertiaKgM2: null });
    const result = gradeMassProperties({ reference: part(), student });
    expect(result.factors).toHaveLength(1);
    expect(result.factors[0]!.id).toBe("mass");
    expect(result.inertiaUngradedReason).toBeTruthy();
    // Not scored as a pass it never measured.
    expect(result.whatToCheck.join(" ")).toContain("not graded");
  });

  it("has a mass band tighter than the MOI band, because MOI amplifies the same error", () => {
    expect(CAD_GRADE_TOLERANCE.mass.match).toBeLessThan(CAD_GRADE_TOLERANCE.momentOfInertia.match);
    expect(CAD_GRADE_TOLERANCE.mass.close).toBeLessThan(CAD_GRADE_TOLERANCE.momentOfInertia.close);
  });
});
