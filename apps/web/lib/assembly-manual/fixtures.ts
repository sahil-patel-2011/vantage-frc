import type { AssemblyFacts, BoxMm, InstanceFacts, MateFacts, PartFacts } from "./model";

/**
 * Synthetic assemblies for the unit tests.
 *
 * Kept in a non-test file so several test files can share them without one
 * importing another's internals. Nothing here is used at runtime.
 */

export function box(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
): BoxMm {
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

export function part(input: Partial<PartFacts> & { key: string; name: string }): PartFacts {
  return {
    documentId: "doc",
    wvm: "w",
    workspaceId: "ws",
    elementId: "el",
    partId: input.key,
    material: null,
    massKg: null,
    volumeM3: null,
    bboxMm: null,
    ...input,
  };
}

export function instance(input: Partial<InstanceFacts> & { id: string; name: string }): InstanceFacts {
  return {
    kind: "part",
    partKey: input.partKey ?? input.id,
    worldBoxMm: null,
    massKg: null,
    hidden: false,
    ...input,
  };
}

export function mate(id: string, mateType: string, instanceIds: string[]): MateFacts {
  return { id, name: id, mateType, instanceIds };
}

export function facts(input: {
  parts: PartFacts[];
  instances: InstanceFacts[];
  mates: MateFacts[];
  features?: AssemblyFacts["features"];
  gaps?: string[];
}): AssemblyFacts {
  return {
    documentId: "doc",
    workspaceId: "ws",
    elementId: "asm",
    name: "Test assembly",
    parts: input.parts,
    instances: input.instances,
    mates: input.mates,
    features: input.features ?? [],
    gaps: input.gaps ?? [],
  };
}

/**
 * The case that motivates the whole feasibility pass.
 *
 * A gearbox plate with a motor behind it, four motor screws through the plate
 * into the motor, a frame behind the motor, and a wheel in front of the plate
 * covering the screw heads. Put the wheel on before the motor screws — which is
 * exactly what "biggest part first" wants to do, because the wheel is bulky —
 * and a driver can no longer reach the screws from either end.
 *
 *      -X                                                        +X
 *   [ frame ][      motor      ][plate][           wheel          ]
 *              <=========== screw ===========>
 */
export function wheelBeforeScrewsAssembly(): AssemblyFacts {
  return facts({
    parts: [
      part({ key: "plate", name: "Gearbox plate", bboxMm: box(0, 10, 0, 100, 0, 100), massKg: 0.4 }),
      part({ key: "motor", name: "NEO motor", bboxMm: box(-60, 0, 30, 70, 30, 70), massKg: 0.4 }),
      part({ key: "frame", name: "Frame rail", bboxMm: box(-100, -60, 0, 100, 0, 100), massKg: 1.2 }),
      part({ key: "wheel", name: "Traction wheel", bboxMm: box(25, 60, 0, 100, 0, 100), massKg: 0.3 }),
      part({ key: "screw", name: "10-32 x 1.00 SHCS", bboxMm: box(-20, 25, 40, 44, 40, 44), massKg: 0.01 }),
    ],
    instances: [
      instance({ id: "plate", name: "Gearbox plate", worldBoxMm: box(0, 10, 0, 100, 0, 100), massKg: 0.4 }),
      instance({ id: "motor", name: "NEO motor", worldBoxMm: box(-60, 0, 30, 70, 30, 70), massKg: 0.4 }),
      instance({ id: "frame", name: "Frame rail", worldBoxMm: box(-100, -60, 0, 100, 0, 100), massKg: 1.2 }),
      instance({ id: "wheel", name: "Traction wheel", worldBoxMm: box(25, 60, 0, 100, 0, 100), massKg: 0.3 }),
      instance({
        id: "screw",
        name: "10-32 x 1.00 SHCS",
        worldBoxMm: box(-20, 25, 40, 44, 40, 44),
        massKg: 0.01,
      }),
    ],
    mates: [
      mate("m1", "FASTENED", ["frame", "plate"]),
      mate("m2", "FASTENED", ["plate", "motor"]),
      mate("m3", "REVOLUTE", ["plate", "wheel"]),
      mate("m4", "FASTENED", ["screw", "plate"]),
      mate("m5", "FASTENED", ["screw", "motor"]),
    ],
  });
}

/** A small part sitting entirely inside a much larger one — it can never be
 *  brought in once the big one is on the bench. */
export function enclosedPartAssembly(): AssemblyFacts {
  return facts({
    parts: [
      part({ key: "shell", name: "Welded shell", bboxMm: box(0, 200, 0, 200, 0, 200), massKg: 5 }),
      part({ key: "core", name: "Inner block", bboxMm: box(80, 120, 80, 120, 80, 120), massKg: 0.5 }),
    ],
    instances: [
      instance({ id: "shell", name: "Welded shell", worldBoxMm: box(0, 200, 0, 200, 0, 200), massKg: 5 }),
      instance({ id: "core", name: "Inner block", worldBoxMm: box(80, 120, 80, 120, 80, 120), massKg: 0.5 }),
    ],
    mates: [mate("m1", "FASTENED", ["shell", "core"])],
  });
}
