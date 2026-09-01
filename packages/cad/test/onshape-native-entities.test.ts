import { describe, expect, it, vi } from "vitest";
import {
  listOnshapeNativeEntities,
  nativeEntityIds,
  onshapeNativeEntitiesPath,
  parseOnshapeNativeEntities,
  type OnshapeNativeEntitiesHttp,
} from "../src/onshape-native-entities";

const DOC = { documentId: "d1", workspaceId: "w1", elementId: "e1" };

/** Shape Onshape's GET …/bodydetails returns for a solid with faces and edges. */
function bodyDetailsResponse(bodies: unknown[]) {
  return Response.json({ bodies });
}

describe("onshapeNativeEntitiesPath", () => {
  it("targets the native bodydetails REST path, not FeatureScript", () => {
    expect(onshapeNativeEntitiesPath(DOC)).toBe("/partstudios/d/d1/w/w1/e/e1/bodydetails");
    expect(onshapeNativeEntitiesPath(DOC)).not.toContain("featurescript");
  });

  it("refuses a missing document ref instead of guessing", () => {
    expect(() => onshapeNativeEntitiesPath({ ...DOC, elementId: "  " })).toThrow(/elementId is required/i);
  });
});

describe("parseOnshapeNativeEntities", () => {
  it("reads body, face, and edge ids from the REST payload", () => {
    const entities = parseOnshapeNativeEntities({
      bodies: [
        {
          id: "JBD",
          type: "solid",
          faces: [
            { id: "JFC", surface: { type: "plane" } },
            { deterministicId: "JFD", surfaceType: "cylinder" },
          ],
          edges: [
            { id: "JHD", geometry: { type: "line" } },
            { id: "JHE", curve: { type: "circle" } },
          ],
        },
      ],
    });
    expect(entities.bodies).toEqual([{ id: "JBD", bodyType: "solid" }]);
    expect(entities.faces).toEqual([
      { id: "JFC", bodyId: "JBD", surfaceType: "plane" },
      { id: "JFD", bodyId: "JBD", surfaceType: "cylinder" },
    ]);
    expect(entities.edges).toEqual([
      { id: "JHD", bodyId: "JBD", geometryType: "line" },
      { id: "JHE", bodyId: "JBD", geometryType: "circle" },
    ]);
    expect(nativeEntityIds(entities, "edge")).toEqual(["JHD", "JHE"]);
  });

  it("returns empty lists when bodies is empty — never invents ids", () => {
    expect(parseOnshapeNativeEntities({ bodies: [] })).toEqual({ bodies: [], faces: [], edges: [] });
    expect(parseOnshapeNativeEntities({})).toEqual({ bodies: [], faces: [], edges: [] });
    expect(parseOnshapeNativeEntities(null)).toEqual({ bodies: [], faces: [], edges: [] });
    expect(parseOnshapeNativeEntities(undefined)).toEqual({ bodies: [], faces: [], edges: [] });
  });

  it("skips blank ids and does not fabricate tokens from a body without them", () => {
    const entities = parseOnshapeNativeEntities({
      bodies: [
        { type: "solid", faces: [{ surface: { type: "plane" } }], edges: [{ geometry: { type: "line" } }] },
        { id: "  ", faces: [{ id: "" }, { id: "JFC" }] },
      ],
    });
    expect(entities.bodies).toEqual([]);
    expect(entities.faces).toEqual([{ id: "JFC", bodyId: "", surfaceType: "" }]);
    expect(entities.edges).toEqual([]);
  });

  it("de-duplicates ids Onshape repeats in one payload", () => {
    const entities = parseOnshapeNativeEntities({
      bodies: [
        { id: "JBD", faces: [{ id: "JFC" }, { id: "JFC" }], edges: [{ id: "JHD" }] },
        { id: "JBD", edges: [{ id: "JHD" }, { id: "JHE" }] },
      ],
    });
    expect(nativeEntityIds(entities, "body")).toEqual(["JBD"]);
    expect(nativeEntityIds(entities, "face")).toEqual(["JFC"]);
    expect(nativeEntityIds(entities, "edge")).toEqual(["JHD", "JHE"]);
  });
});

describe("listOnshapeNativeEntities against mocked Onshape HTTP", () => {
  it("GETs bodydetails and returns only ids from the response", async () => {
    const calls: Array<{ path: string; method: string; body: string | undefined }> = [];
    const http: OnshapeNativeEntitiesHttp = vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, method: (init?.method ?? "GET").toUpperCase(), body: init?.body ? String(init.body) : undefined });
      return bodyDetailsResponse([
        {
          id: "JBD",
          bodyType: "solid",
          faces: [{ id: "JFC", surface: { type: "plane" } }],
          edges: [{ id: "JHD", geometry: { type: "line" } }, { id: "JHE", geometry: { type: "line" } }],
        },
      ]);
    });

    const entities = await listOnshapeNativeEntities(http, DOC);
    expect(entities.bodies).toEqual([{ id: "JBD", bodyType: "solid" }]);
    expect(nativeEntityIds(entities, "face")).toEqual(["JFC"]);
    expect(nativeEntityIds(entities, "edge")).toEqual(["JHD", "JHE"]);
    expect(calls).toEqual([{ path: "/partstudios/d/d1/w/w1/e/e1/bodydetails", method: "GET", body: undefined }]);
    expect(calls.some((call) => call.path.includes("featurescript"))).toBe(false);
  });

  it("returns empty lists when Onshape reports no bodies", async () => {
    const http: OnshapeNativeEntitiesHttp = vi.fn(async () => bodyDetailsResponse([]));
    await expect(listOnshapeNativeEntities(http, DOC)).resolves.toEqual({
      bodies: [],
      faces: [],
      edges: [],
    });
  });

  it("surfaces Onshape's own error text instead of inventing geometry", async () => {
    const http: OnshapeNativeEntitiesHttp = vi.fn(async () =>
      Response.json({ message: "Element is not a Part Studio" }, { status: 400 }),
    );
    await expect(listOnshapeNativeEntities(http, DOC)).rejects.toThrow(/Element is not a Part Studio/);
  });

  it("explains a non-JSON response instead of throwing a parse error", async () => {
    const http: OnshapeNativeEntitiesHttp = vi.fn(async () => new Response("<html>gateway</html>", { status: 502 }));
    await expect(listOnshapeNativeEntities(http, DOC)).rejects.toThrow(/non-JSON \(502\)/);
  });
});
