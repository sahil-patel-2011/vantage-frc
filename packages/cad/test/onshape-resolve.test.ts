import { describe, expect, it, vi } from "vitest";
import {
  ALL_SOLID_BODIES_SCRIPT,
  collectFeatureScriptStrings,
  createdByScript,
  cylindricalFacesScript,
  evaluateOnshapeQuery,
  parallelEdgesScript,
  resolveOnshapeAxisIds,
  resolveOnshapeEdgeIds,
  resolveOnshapeSolidBodyIds,
  resolveOnshapeVertexIds,
  type OnshapeResolveHttp,
} from "../src/onshape-resolve";

const DOC = { documentId: "d1", workspaceId: "w1", elementId: "e1" };

/** Onshape's real BTFSValue envelope for `transientQueriesToStrings(...)`. */
function fsResponse(ids: string[], notices: string[] = []) {
  return Response.json({
    result: {
      btType: "BTFSValueArray-2125",
      typeTag: "",
      value: ids.map((id) => ({ btType: "BTFSValueString-1358", typeTag: "", value: id })),
    },
    notices: notices.map((message) => ({ message })),
  });
}

describe("FeatureScript value parsing", () => {
  it("collects string leaves and ignores btType metadata", () => {
    const ids = collectFeatureScriptStrings({
      btType: "BTFSValueArray-2125",
      typeTag: "",
      value: [
        { btType: "BTFSValueString-1358", value: "JHD" },
        { btType: "BTFSValueString-1358", value: "JHE" },
      ],
    });
    expect(ids).toEqual(["JHD", "JHE"]);
  });

  it("stays bounded on deeply nested or huge results", () => {
    let nested: unknown = "deep";
    for (let i = 0; i < 40; i++) nested = { value: nested };
    expect(collectFeatureScriptStrings(nested)).toEqual([]);
  });
});

describe("script builders", () => {
  it("builds a qCreatedBy lambda per entity type", () => {
    expect(createdByScript("FExtrude", "EDGE")).toContain('qCreatedBy(makeId("FExtrude"), EntityType.EDGE)');
    expect(createdByScript("FSketch", "VERTEX")).toContain("EntityType.VERTEX");
    expect(ALL_SOLID_BODIES_SCRIPT).toContain("qAllSolidBodies()");
    expect(cylindricalFacesScript("FHole")).toContain("GeometryType.CYLINDER");
  });

  it("filters corner edges by the extrude axis", () => {
    const script = parallelEdgesScript("FExtrude", [0, 0, 1]);
    expect(script).toContain("GeometryType.LINE");
    expect(script).toContain("evEdgeTangentLine");
    expect(script).toContain("vector(0, 0, 1)");
  });

  it("refuses a feature id that could inject FeatureScript", () => {
    expect(() => createdByScript('X"); doSomething("', "EDGE")).toThrow(/not a valid Onshape feature id/i);
    expect(() => parallelEdgesScript("", [0, 0, 1])).toThrow(/not a valid Onshape feature id/i);
  });
});

describe("resolvers against mocked Onshape HTTP", () => {
  it("posts the lambda to the featurescript endpoint and returns deterministic ids", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const http: OnshapeResolveHttp = vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, body: JSON.parse(String(init?.body ?? "{}")) });
      return fsResponse(["JHD", "JHE", "JHD"]);
    }) as unknown as OnshapeResolveHttp;

    const ids = await resolveOnshapeEdgeIds(http, DOC, { featureId: "FExtrude", selection: "corners", plane: "Top" });
    expect(ids).toEqual(["JHD", "JHE"]); // de-duplicated
    expect(calls[0]!.path).toBe("/partstudios/d/d1/w/w1/e/e1/featurescript");
    expect((calls[0]!.body as { script: string }).script).toContain("evEdgeTangentLine");
  });

  it("returns an empty list rather than inventing geometry", async () => {
    const http: OnshapeResolveHttp = vi.fn(async () => fsResponse([])) as unknown as OnshapeResolveHttp;
    expect(await resolveOnshapeVertexIds(http, DOC, "FPoints")).toEqual([]);
  });

  it("falls back to every solid body when no feature is named", async () => {
    let script = "";
    const http: OnshapeResolveHttp = vi.fn(async (_path: string, init?: RequestInit) => {
      script = (JSON.parse(String(init?.body ?? "{}")) as { script: string }).script;
      return fsResponse(["JBODY"]);
    }) as unknown as OnshapeResolveHttp;
    expect(await resolveOnshapeSolidBodyIds(http, DOC)).toEqual(["JBODY"]);
    expect(script).toContain("qAllSolidBodies");
  });

  it("surfaces Onshape's own error text on a failed evaluation", async () => {
    const http: OnshapeResolveHttp = vi.fn(async () =>
      Response.json({ message: "Unknown function qBogus" }, { status: 400 }),
    ) as unknown as OnshapeResolveHttp;
    await expect(resolveOnshapeAxisIds(http, DOC, "FHole")).rejects.toThrow(/Unknown function qBogus/);
  });

  it("reports notices alongside ids", async () => {
    const http: OnshapeResolveHttp = vi.fn(async () =>
      fsResponse(["JF1"], ["Query matched no faces"]),
    ) as unknown as OnshapeResolveHttp;
    const result = await evaluateOnshapeQuery(http, DOC, cylindricalFacesScript("FHole"));
    expect(result.ids).toEqual(["JF1"]);
    expect(result.notices).toEqual(["Query matched no faces"]);
  });

  it("explains a non-JSON response instead of throwing a parse error", async () => {
    const http: OnshapeResolveHttp = vi.fn(async () =>
      new Response("<html>gateway</html>", { status: 502 }),
    ) as unknown as OnshapeResolveHttp;
    await expect(resolveOnshapeVertexIds(http, DOC, "FPoints")).rejects.toThrow(/non-JSON \(502\)/);
  });
});
