import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_LISTED_ENTITIES,
  completeDocumentRef,
  listOnshapeEntities,
  parseListedEntities,
  pickableEntityIds,
  rejectDemoEntityId,
  toggleIdListValue,
} from "./list-entities";

const ORG = "00000000-0000-0000-0000-000000000001";
const JOB = "00000000-0000-0000-0000-0000000000aa";
const DOCUMENT = { documentId: "did", workspaceId: "wid", elementId: "eid" };
const LIVE = {
  bodies: [{ id: "JBD", bodyType: "solid" }],
  faces: [{ id: "JFC", bodyId: "JBD", surfaceType: "plane" }],
  edges: [
    { id: "JHD", bodyId: "JBD", geometryType: "line" },
    { id: "JHE", bodyId: "JBD", geometryType: "circle" },
  ],
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch(handler: (url: string, body: Record<string, unknown> | null) => Response) {
  const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url, body });
    return handler(url, body);
  }) as typeof fetch;
  return calls;
}

describe("rejectDemoEntityId", () => {
  it("returns a real id and refuses DEMO tokens", () => {
    expect(rejectDemoEntityId("JHD")).toBe("JHD");
    expect(rejectDemoEntityId("  JFC  ")).toBe("JFC");
    expect(rejectDemoEntityId("")).toBe("");
    expect(() => rejectDemoEntityId("DEMO-edge-1")).toThrow(/DEMO entity id/i);
    expect(() => rejectDemoEntityId("demo-face")).toThrow(/DEMO entity id/i);
  });
});

describe("parseListedEntities", () => {
  it("reads ids from the POST /api/cad wrapper", () => {
    expect(parseListedEntities({ entities: LIVE, documentRef: DOCUMENT, authPath: "oauth" })).toEqual(LIVE);
  });

  it("accepts the entities object itself", () => {
    expect(parseListedEntities(LIVE)).toEqual(LIVE);
  });

  it("returns empty lists when nothing was listed — never invents ids", () => {
    expect(parseListedEntities({ entities: { bodies: [], faces: [], edges: [] } })).toEqual(EMPTY_LISTED_ENTITIES);
    expect(parseListedEntities({ entities: null })).toEqual(EMPTY_LISTED_ENTITIES);
    expect(parseListedEntities({})).toEqual(EMPTY_LISTED_ENTITIES);
    expect(parseListedEntities(null)).toEqual(EMPTY_LISTED_ENTITIES);
    expect(parseListedEntities(undefined)).toEqual(EMPTY_LISTED_ENTITIES);
    expect(JSON.stringify(parseListedEntities({}))).not.toMatch(/DEMO/i);
    expect(JSON.stringify(parseListedEntities({}))).not.toMatch(/JHD|JFC|edge-1|face-1/);
  });

  it("skips blank ids and de-duplicates", () => {
    expect(
      parseListedEntities({
        entities: {
          bodies: [{ id: "  " }, { id: "JBD", bodyType: "solid" }, { id: "JBD" }],
          faces: [{ id: "" }, { id: "JFC", bodyId: "JBD", surfaceType: "plane" }],
          edges: [{ id: "JHD" }, { id: "JHD", bodyId: "JBD", geometryType: "line" }],
        },
      }),
    ).toEqual({
      bodies: [{ id: "JBD", bodyType: "solid" }],
      faces: [{ id: "JFC", bodyId: "JBD", surfaceType: "plane" }],
      edges: [{ id: "JHD", bodyId: "", geometryType: "" }],
    });
  });

  it("rejects DEMO ids instead of passing them to the composer", () => {
    expect(() => parseListedEntities({ entities: { ...LIVE, edges: [{ id: "DEMO-plate-edge" }] } })).toThrow(
      /DEMO entity id/i,
    );
    expect(() => parseListedEntities({ entities: { bodies: [{ id: "demo-body" }], faces: [], edges: [] } })).toThrow(
      /DEMO entity id/i,
    );
  });
});

describe("pickableEntityIds", () => {
  const FEATURES = [{ featureId: "Fsketch" }, { id: "Fextrude" }];

  it("maps fillet entities to edges and hole faces to faces", () => {
    expect(pickableEntityIds("entities", LIVE)).toEqual(["JHD", "JHE"]);
    expect(pickableEntityIds("edgeIds", LIVE)).toEqual(["JHD", "JHE"]);
    expect(pickableEntityIds("faceIds", LIVE)).toEqual(["JFC"]);
    expect(pickableEntityIds("targetFaceId", LIVE)).toEqual(["JFC"]);
    expect(pickableEntityIds("bodyIds", LIVE)).toEqual(["JBD"]);
  });

  it("maps featureIds to extras.features and sketchFeatureId if called anyway", () => {
    expect(pickableEntityIds("featureIds", LIVE, { features: FEATURES })).toEqual(["Fsketch", "Fextrude"]);
    expect(pickableEntityIds("featureId", LIVE, { features: FEATURES })).toEqual(["Fsketch", "Fextrude"]);
    expect(pickableEntityIds("sketchFeatureId", LIVE, { features: FEATURES })).toEqual(["Fsketch", "Fextrude"]);
    expect(pickableEntityIds("featureIds", LIVE)).toEqual([]);
    expect(pickableEntityIds("featureIds", LIVE, { features: [] })).toEqual([]);
    expect(pickableEntityIds("featureIds", LIVE, { features: [{ featureId: "  " }, { id: "" }] })).toEqual([]);
  });

  it("refuses DEMO feature extras instead of showing them in the picker", () => {
    expect(() => pickableEntityIds("featureIds", LIVE, { features: [{ featureId: "DEMO-plate" }] })).toThrow(
      /DEMO entity id/i,
    );
    expect(() => pickableEntityIds("featureId", LIVE, { features: [{ id: "demo-extrude" }] })).toThrow(
      /DEMO entity id/i,
    );
  });

  it("maps firstInstanceId / secondInstanceId to extras.instances", () => {
    const INSTANCES = [{ id: "Mi1" }, { id: "Mi2" }];
    expect(pickableEntityIds("firstInstanceId", LIVE, { instances: INSTANCES })).toEqual(["Mi1", "Mi2"]);
    expect(pickableEntityIds("secondInstanceId", LIVE, { instances: INSTANCES })).toEqual(["Mi1", "Mi2"]);
    expect(pickableEntityIds("firstInstanceId", LIVE)).toEqual([]);
    expect(pickableEntityIds("secondInstanceId", LIVE, { instances: [] })).toEqual([]);
    expect(pickableEntityIds("firstInstanceId", LIVE, { instances: [{ id: "  " }, { id: "" }] })).toEqual([]);
  });

  it("refuses DEMO instance extras instead of showing them in the picker", () => {
    expect(() => pickableEntityIds("firstInstanceId", LIVE, { instances: [{ id: "DEMO-instance" }] })).toThrow(
      /DEMO entity id/i,
    );
    expect(() => pickableEntityIds("secondInstanceId", LIVE, { instances: [{ id: "demo-mate" }] })).toThrow(
      /DEMO entity id/i,
    );
  });

  it("maps planeIds to plane faces and axisIds to cylinder/circle faces", () => {
    expect(pickableEntityIds("planeIds", LIVE)).toEqual(["JFC"]);
    expect(pickableEntityIds("planeId", LIVE)).toEqual(["JFC"]);
    expect(pickableEntityIds("axisIds", LIVE)).toEqual([]);
    expect(pickableEntityIds("axis", LIVE)).toEqual([]);
    expect(
      pickableEntityIds("axisIds", {
        ...LIVE,
        faces: [
          ...LIVE.faces,
          { id: "JFD", bodyId: "JBD", surfaceType: "cylinder" },
          { id: "JFE", bodyId: "JBD", surfaceType: "circle" },
        ],
      }),
    ).toEqual(["JFD", "JFE"]);
  });

  it("keeps views and empty entities as an empty picker", () => {
    expect(pickableEntityIds("views", LIVE)).toEqual([]);
    expect(pickableEntityIds("entities", EMPTY_LISTED_ENTITIES)).toEqual([]);
    expect(pickableEntityIds("entities", undefined)).toEqual([]);
    expect(pickableEntityIds("entities", null)).toEqual([]);
    expect(pickableEntityIds("unknown", LIVE)).toEqual([]);
  });
});

describe("toggleIdListValue", () => {
  it("adds and removes a real id in the paste field", () => {
    expect(toggleIdListValue("", "JHD")).toBe("JHD");
    expect(toggleIdListValue("JHD", "JHE")).toBe("JHD, JHE");
    expect(toggleIdListValue("JHD, JHE", "JHD")).toBe("JHE");
  });

  it("refuses to toggle a DEMO id into the list", () => {
    expect(() => toggleIdListValue("JHD", "DEMO-edge")).toThrow(/DEMO entity id/i);
  });
});

describe("completeDocumentRef", () => {
  it("requires document, workspace, and element — never guesses", () => {
    expect(completeDocumentRef(DOCUMENT)).toEqual(DOCUMENT);
    expect(completeDocumentRef({ documentId: "did", workspaceId: "wid" })).toBeNull();
    expect(completeDocumentRef({ ...DOCUMENT, elementId: "  " })).toBeNull();
    expect(completeDocumentRef(null)).toBeNull();
  });
});

describe("listOnshapeEntities", () => {
  it("POSTs list-onshape-entities and returns ids Onshape already listed", async () => {
    const calls = installFetch((_url, body) => {
      expect(body?.action).toBe("list-onshape-entities");
      return jsonResponse({ entities: LIVE, documentRef: DOCUMENT, authPath: "oauth" });
    });

    await expect(listOnshapeEntities({ orgId: ORG, documentRef: DOCUMENT })).resolves.toEqual(LIVE);

    expect(calls).toEqual([
      {
        url: "/api/cad",
        body: { action: "list-onshape-entities", orgId: ORG, documentRef: DOCUMENT },
      },
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/DEMO/i);
  });

  it("can list from a bound job without inventing a document ref", async () => {
    const calls = installFetch(() => jsonResponse({ entities: LIVE, authPath: "oauth" }));
    await expect(listOnshapeEntities({ orgId: ORG, jobId: JOB })).resolves.toEqual(LIVE);
    expect(calls[0]?.body).toEqual({ action: "list-onshape-entities", orgId: ORG, jobId: JOB });
    expect(calls[0]?.body).not.toHaveProperty("documentRef");
  });

  it("returns empty lists when the API listed nothing", async () => {
    installFetch(() => jsonResponse({ entities: { bodies: [], faces: [], edges: [] } }));
    await expect(listOnshapeEntities({ orgId: ORG, documentRef: DOCUMENT })).resolves.toEqual(EMPTY_LISTED_ENTITIES);
  });

  it("does not fetch when orgId or a document bind is missing", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await expect(listOnshapeEntities({ orgId: "", documentRef: DOCUMENT })).rejects.toThrow(/orgId/i);
    await expect(listOnshapeEntities({ orgId: ORG })).rejects.toThrow(/document\/workspace\/element/i);
    await expect(listOnshapeEntities({ orgId: ORG, documentRef: { documentId: "did" } })).rejects.toThrow(
      /document\/workspace\/element/i,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces a hosted error and never invents ids", async () => {
    installFetch(() => jsonResponse({ error: "Bind an Onshape document/workspace/element first" }, 400));
    await expect(listOnshapeEntities({ orgId: ORG, documentRef: DOCUMENT })).rejects.toThrow(
      /document\/workspace\/element/i,
    );
  });

  it("rejects a DEMO payload from the API", async () => {
    installFetch(() => jsonResponse({ entities: { bodies: [], faces: [], edges: [{ id: "DEMO-edge-1" }] } }));
    await expect(listOnshapeEntities({ orgId: ORG, documentRef: DOCUMENT })).rejects.toThrow(/DEMO entity id/i);
  });
});
