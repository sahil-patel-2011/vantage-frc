import { describe, expect, it } from "vitest";
import {
  IngestIncomplete,
  flattenParameters,
  ingestAssembly,
  parseAssemblyDefinition,
  parseBoundingBox,
  parseFeatureList,
  parseStudioMassProperties,
  parseStudioParts,
  transformBox,
} from "./ingest";

describe("parseBoundingBox", () => {
  it("converts Onshape metres to the millimetres the engine works in", () => {
    expect(
      parseBoundingBox({ lowX: -0.05, lowY: 0, lowZ: 0, highX: 0.4445, highY: 0.0254, highZ: 0.0254 }),
    ).toEqual({ minX: -50, minY: 0, minZ: 0, maxX: 444.5, maxY: 25.4, maxZ: 25.4 });
  });

  it("returns null for a payload missing a coordinate rather than defaulting it to zero", () => {
    expect(parseBoundingBox({ lowX: 0, lowY: 0, highX: 1, highY: 1 })).toBeNull();
    expect(parseBoundingBox(null)).toBeNull();
    expect(parseBoundingBox("nope")).toBeNull();
  });
});

describe("parseStudioMassProperties", () => {
  it("reads per-part mass and skips the -all- aggregate", () => {
    const parsed = parseStudioMassProperties({
      bodies: {
        "-all-": { mass: [1.5, 1.5, 1.5], volume: [0.001, 0.001, 0.001] },
        JHD: { mass: [0.4, 0.4, 0.4], volume: [0.0002, 0.0002, 0.0002] },
        JHK: { mass: 1.1 },
      },
    });
    expect(parsed.has("-all-")).toBe(false);
    expect(parsed.get("JHD")).toEqual({ massKg: 0.4, volumeM3: 0.0002 });
    // A body with no volume reported keeps null; it does not become zero.
    expect(parsed.get("JHK")).toEqual({ massKg: 1.1, volumeM3: null });
  });

  it("is empty rather than throwing when Onshape returned nothing usable", () => {
    expect(parseStudioMassProperties(null).size).toBe(0);
    expect(parseStudioMassProperties({ bodies: "?" }).size).toBe(0);
  });
});

describe("parseStudioParts", () => {
  it("keeps the material Onshape assigned and drops rows with no part id", () => {
    const parts = parseStudioParts([
      { partId: "JHD", name: "1x1 tube", material: { displayName: "6061 Aluminum" }, bodyType: "solid" },
      { name: "orphan" },
    ]);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({ partId: "JHD", name: "1x1 tube", material: "6061 Aluminum", bodyType: "solid" });
  });

  it("leaves material null when nothing is assigned", () => {
    expect(parseStudioParts([{ partId: "A", name: "Plate" }])[0]!.material).toBeNull();
  });
});

describe("flattenParameters", () => {
  it("keeps quantity expressions verbatim, so nothing is silently re-rounded", () => {
    const flat = flattenParameters([
      { parameterId: "holeDiameter", message: { expression: "0.196 in" } },
      { parameterId: "style", message: { value: "SIMPLE" } },
      { parameterId: "oppositeDirection", message: { value: false } },
      { parameterId: "count", message: { value: 4 } },
      { parameterId: "locations", message: { queries: [{}, {}, {}] } },
      { message: { value: "no id" } },
    ]);
    expect(flat).toEqual({
      holeDiameter: "0.196 in",
      style: "SIMPLE",
      oppositeDirection: false,
      count: 4,
      locations__count: 3,
    });
  });
});

describe("parseFeatureList", () => {
  it("reads the feature tree with its parameters attached", () => {
    const features = parseFeatureList(
      {
        features: [
          {
            message: {
              featureId: "F1",
              name: "Bolt holes",
              featureType: "hole",
              suppressed: false,
              parameters: [{ parameterId: "holeDiameter", message: { expression: "0.196 in" } }],
            },
          },
          { message: { featureId: "F2", name: "Body", featureType: "extrude", suppressed: true, parameters: [] } },
        ],
      },
      "EL1",
    );
    expect(features).toHaveLength(2);
    expect(features[0]).toEqual({
      elementId: "EL1",
      id: "F1",
      name: "Bolt holes",
      featureType: "hole",
      suppressed: false,
      parameters: { holeDiameter: "0.196 in" },
    });
    expect(features[1]!.suppressed).toBe(true);
  });

  it("returns nothing for a payload with no features", () => {
    expect(parseFeatureList(null, "EL")).toEqual([]);
    expect(parseFeatureList({}, "EL")).toEqual([]);
  });
});

describe("parseAssemblyDefinition", () => {
  const payload = {
    rootAssembly: {
      instances: [
        { id: "M1", type: "Part", name: "Plate <1>", documentId: "D1", elementId: "E1", partId: "JHD" },
        { id: "M2", type: "Part", name: "Tube <1>", documentId: "D2", documentMicroversion: "MV", elementId: "E2", partId: "JHK" },
        { id: "M3", type: "Assembly", name: "Gearbox <1>", documentId: "D1", elementId: "E3" },
      ],
      occurrences: [
        { path: ["M1"], transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0.1, 0, 0, 0, 1], hidden: false },
        { path: ["M3", "inner"], transform: null, hidden: true },
      ],
      features: [
        {
          id: "MF1",
          featureType: "mate",
          featureData: {
            name: "Fasten 1",
            mateType: "FASTENED",
            matedEntities: [{ matedOccurrence: ["M1"] }, { matedOccurrence: ["M2"] }],
          },
        },
        {
          id: "MF2",
          featureType: "mate",
          featureData: { name: "Dangler", mateType: "REVOLUTE", matedEntities: [{ matedOccurrence: ["M1"] }] },
        },
      ],
    },
  };

  it("reads instances with their source document and kind", () => {
    const parsed = parseAssemblyDefinition(payload);
    expect(parsed.instances.map((instance) => instance.kind)).toEqual(["part", "part", "assembly"]);
    expect(parsed.instances[1]!.microversionId).toBe("MV");
  });

  it("keeps only top-level occurrence transforms", () => {
    const parsed = parseAssemblyDefinition(payload);
    expect(parsed.occurrences).toHaveLength(2);
    expect(parsed.occurrences[0]!.transform).toHaveLength(16);
    expect(parsed.occurrences[1]!.transform).toBeNull();
  });

  it("drops a mate that does not join two instances rather than attaching it to a guess", () => {
    const parsed = parseAssemblyDefinition(payload);
    expect(parsed.mates).toHaveLength(1);
    expect(parsed.mates[0]).toEqual({ id: "MF1", name: "Fasten 1", mateType: "FASTENED", instanceIds: ["M1", "M2"] });
  });

  it("treats a mate group as fastening everything it lists", () => {
    const parsed = parseAssemblyDefinition({
      rootAssembly: {
        instances: [],
        occurrences: [],
        features: [
          {
            id: "G1",
            featureType: "mateGroup",
            featureData: { name: "Group", occurrences: [{ occurrence: ["A"] }, { occurrence: ["B"] }] },
          },
        ],
      },
    });
    expect(parsed.mates[0]!.mateType).toBe("FASTENED");
    expect(parsed.mates[0]!.instanceIds).toEqual(["A", "B"]);
  });

  it("returns empty structures for junk rather than throwing", () => {
    expect(parseAssemblyDefinition(null)).toEqual({ instances: [], occurrences: [], mates: [] });
  });
});

describe("transformBox", () => {
  it("moves a box by the transform's translation, converting metres to mm", () => {
    const moved = transformBox(
      { minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: 0, maxZ: 10 },
      [1, 0, 0, 0.1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    );
    expect(moved.minX).toBeCloseTo(100, 6);
    expect(moved.maxX).toBeCloseTo(110, 6);
  });

  it("re-bounds a rotated box, never smaller than the part inside it", () => {
    const original = { minX: 0, maxX: 40, minY: 0, maxY: 10, minZ: 0, maxZ: 10 };
    // 45 degrees about Z.
    const c = Math.SQRT1_2;
    const rotated = transformBox(original, [c, -c, 0, 0, c, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(rotated.maxX - rotated.minX).toBeGreaterThan(40 * c);
    expect(rotated.maxY - rotated.minY).toBeGreaterThan(10);
  });

  it("leaves the box alone when there is no usable transform", () => {
    const original = { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 };
    expect(transformBox(original, null)).toEqual(original);
    expect(transformBox(original, [1, 2, 3])).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// The resumable network pass, against a fake Onshape
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeOnshape(calls: string[]) {
  return async (path: string): Promise<Response> => {
    calls.push(path);
    if (path.startsWith("/assemblies/")) {
      return json({
        rootAssembly: {
          instances: [
            { id: "M1", type: "Part", name: "Plate", documentId: "D", elementId: "E1", partId: "P1" },
            { id: "M2", type: "Part", name: "Tube", documentId: "D", elementId: "E1", partId: "P2" },
          ],
          occurrences: [
            { path: ["M1"], transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
            { path: ["M2"], transform: [1, 0, 0, 0.2, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
          ],
          features: [
            {
              id: "MF1",
              featureType: "mate",
              featureData: {
                name: "Fasten",
                mateType: "FASTENED",
                matedEntities: [{ matedOccurrence: ["M1"] }, { matedOccurrence: ["M2"] }],
              },
            },
          ],
        },
      });
    }
    if (path.includes("/boundingboxes")) {
      return json({ lowX: 0, lowY: 0, lowZ: 0, highX: 0.1, highY: 0.02, highZ: 0.02 });
    }
    if (path.startsWith("/parts/")) {
      return json([
        { partId: "P1", name: "Plate", material: { displayName: "6061" } },
        { partId: "P2", name: "Tube", material: { displayName: "6061" } },
      ]);
    }
    if (path.includes("/massproperties")) {
      return json({ bodies: { P1: { mass: [0.4] }, P2: { mass: [0.6] } } });
    }
    if (path.includes("/features")) {
      return json({ features: [{ message: { featureId: "F1", name: "Body", featureType: "extrude", parameters: [] } }] });
    }
    return json({}, 404);
  };
}

const ref = { documentId: "D", workspaceId: "W", elementId: "ASM" };

describe("ingestAssembly", () => {
  it("reads parts, mates, masses and boxes from one assembly", async () => {
    const calls: string[] = [];
    const result = await ingestAssembly({ http: fakeOnshape(calls), ...ref, assemblyName: "Chassis" });

    expect(result.facts.name).toBe("Chassis");
    expect(result.facts.parts.map((part) => part.name).sort()).toEqual(["Plate", "Tube"]);
    expect(result.facts.parts[0]!.massKg).toBe(0.4);
    expect(result.facts.parts[0]!.material).toBe("6061");
    expect(result.facts.mates).toHaveLength(1);
    expect(result.facts.instances[1]!.worldBoxMm!.minX).toBeCloseTo(200, 6);
    expect(result.calls).toBe(calls.length);
  });

  it("resumes from its checkpoint instead of re-reading Onshape", async () => {
    // First slice: stop after four calls, as a worker running out of time does.
    const firstCalls: string[] = [];
    let made = 0;
    let paused: IngestIncomplete | null = null;
    try {
      await ingestAssembly({
        http: fakeOnshape(firstCalls),
        ...ref,
        progress: {
          onCall: () => {
            made += 1;
          },
          shouldStop: () => made >= 4,
        },
      });
    } catch (error) {
      paused = error as IngestIncomplete;
    }

    expect(paused).toBeInstanceOf(IngestIncomplete);
    expect(firstCalls.length).toBe(4);

    // Second slice: same cache, and the four calls already made are not repeated.
    const secondCalls: string[] = [];
    const finished = await ingestAssembly({
      http: fakeOnshape(secondCalls),
      ...ref,
      cache: paused!.cache,
    });

    expect(secondCalls.length).toBeLessThan(firstCalls.length + secondCalls.length);
    for (const path of firstCalls) expect(secondCalls).not.toContain(path);
    expect(finished.facts.parts).toHaveLength(2);
    expect(finished.facts.instances[1]!.worldBoxMm).not.toBeNull();
  });

  it("says what it could not read instead of filling the gap", async () => {
    const http = async (path: string): Promise<Response> => {
      if (path.startsWith("/assemblies/")) {
        return json({
          rootAssembly: {
            instances: [{ id: "M1", type: "Part", name: "Plate", documentId: "D", elementId: "E1", partId: "P1" }],
            occurrences: [],
            features: [],
          },
        });
      }
      if (path.includes("/boundingboxes")) return json({}, 403);
      if (path.startsWith("/parts/")) return json([{ partId: "P1", name: "Plate" }]);
      return json({}, 500);
    };
    const result = await ingestAssembly({ http, ...ref });

    expect(result.facts.parts[0]!.bboxMm).toBeNull();
    expect(result.facts.parts[0]!.massKg).toBeNull();
    expect(result.facts.gaps.some((gap) => gap.includes("403"))).toBe(true);
    expect(result.facts.gaps.some((gap) => gap.includes("bounding box"))).toBe(true);
  });

  it("turns an Onshape refusal on the assembly itself into a sentence a person can act on", async () => {
    await expect(
      ingestAssembly({ http: async () => json({}, 403), ...ref }),
    ).rejects.toThrow(/Reconnect Onshape/);
    await expect(
      ingestAssembly({ http: async () => json({}, 404), ...ref }),
    ).rejects.toThrow(/Assembly tab/);
  });
});
