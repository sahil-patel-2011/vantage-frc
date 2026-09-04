import { describe, expect, it } from "vitest";
import { callClaudeCadTool } from "../src/claude-cad";
import { shellFeature } from "../src/onshape-features";
import { CAD_TOOL_CATALOG } from "../src/cad-tool-catalog";
import type { CadSessionFeature, ClaudeCadSession } from "../src/claude-session";

/**
 * The native tools that close the gaps which used to force a part through the
 * FeatureScript pipeline: revolve, boolean, shell, and variables.
 *
 * Every assertion here is about the same promise — the agent leaves behind ordinary
 * Onshape features a human can open, so no request may carry generated FeatureScript,
 * and no id may be invented when Onshape returns no geometry.
 */

const DOC = { documentId: "d1", workspaceId: "w1", elementId: "e1" };

function fsResponse(ids: string[]) {
  return Response.json({
    result: {
      btType: "BTFSValueArray-2125",
      typeTag: "",
      value: ids.map((id) => ({ btType: "BTFSValueString-1358", typeTag: "", value: id })),
    },
    notices: [],
  });
}

function feature(overrides: Partial<CadSessionFeature> & { featureId: string }): CadSessionFeature {
  return {
    kind: "solid",
    tool: "onshape_extrude",
    name: "VantagePlate",
    at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as CadSessionFeature;
}

type Call = { path: string; method: string; body: string };

/**
 * @param queryIds deterministic ids the read-only FeatureScript query resolves to,
 *   keyed loosely so one harness serves face, line, and body lookups.
 */
function harness(options: { session?: ClaudeCadSession; queryIds?: string[] } = {}) {
  const calls: Call[] = [];
  let session: ClaudeCadSession = options.session ?? {
    ...DOC,
    features: [feature({ featureId: "FExtrude" })],
  };
  let added = 0;
  const http = async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ path, method, body: String(init?.body ?? "") });
    if (path.includes("/featurescript")) return fsResponse(options.queryIds ?? ["JFC"]);
    if (path.endsWith("/features") && method === "POST") {
      added += 1;
      return Response.json({ feature: { featureId: `FNew${added}` } });
    }
    return Response.json({});
  };
  const runtime = {
    http,
    hosted: true,
    loadSession: async () => session,
    saveSession: async (next: ClaudeCadSession) => {
      session = next;
    },
  };
  return { runtime, calls, session: () => session };
}

function postedFeature(calls: Call[]): Record<string, unknown> {
  const call = calls.find((entry) => entry.path.endsWith("/features") && entry.method === "POST");
  if (!call) throw new Error("no feature was posted");
  return (JSON.parse(call.body) as { feature: Record<string, unknown> }).feature;
}

function noFeatureScriptWasWritten(calls: Call[]): void {
  // Read-only queries POST to /featurescript to resolve ids; that is allowed. What is not
  // allowed is a *feature* whose body carries FeatureScript source or a custom feature type.
  const written = calls.filter((call) => call.path.endsWith("/features") && call.method === "POST");
  for (const call of written) {
    expect(call.body).not.toMatch(/FeatureScript|opExtrude|opShell|opRevolve|importMicroversion/i);
  }
}

describe("catalog exposes the native gap-closers", () => {
  it("lists revolve, boolean, shell, and both variable tools as Onshape-supported", () => {
    const byName = new Map(CAD_TOOL_CATALOG.map((tool) => [tool.name, tool]));
    for (const name of [
      "onshape_revolve",
      "onshape_boolean",
      "onshape_shell",
      "onshape_variable_list",
      "onshape_variable_set",
    ]) {
      expect(byName.get(name)?.onshape, name).toBe("supported");
    }
  });

  it("does not claim Fusion can run them", () => {
    const byName = new Map(CAD_TOOL_CATALOG.map((tool) => [tool.name, tool]));
    for (const name of ["onshape_revolve", "onshape_boolean", "onshape_shell"]) {
      expect(byName.get(name)?.fusion, name).toBe("unsupported");
      expect(byName.get(name)?.fusionNote, name).toBeTruthy();
    }
  });
});

describe("onshape_revolve", () => {
  it("turns a profile about the single line in the axis sketch", async () => {
    const { runtime, calls } = harness({
      session: {
        ...DOC,
        lastSketchFeatureId: "FProfile",
        features: [feature({ featureId: "FProfile", kind: "sketch", tool: "onshape_sketch_polyline" })],
      },
      queryIds: ["JAxisLine"],
    });
    const result = (await callClaudeCadTool(
      "onshape_revolve",
      { axisSketchFeatureId: "FAxis", angleDeg: 360 },
      runtime,
    )) as { featureId: string; featureScriptUsed: boolean };

    expect(result.featureId).toBe("FNew1");
    expect(result.featureScriptUsed).toBe(false);
    const posted = postedFeature(calls);
    expect(posted.featureType).toBe("revolve");
    noFeatureScriptWasWritten(calls);
  });

  it("refuses to guess which line is the axis", async () => {
    const { runtime } = harness({
      session: { ...DOC, lastSketchFeatureId: "FProfile" },
      queryIds: ["JLineA", "JLineB"],
    });
    await expect(
      callClaudeCadTool("onshape_revolve", { axisSketchFeatureId: "FAxis" }, runtime),
    ).rejects.toThrow(/ambiguous|sketch of its own/i);
  });

  it("says so rather than inventing an axis when the sketch has no lines", async () => {
    const { runtime, calls } = harness({
      session: { ...DOC, lastSketchFeatureId: "FProfile" },
      queryIds: [],
    });
    await expect(
      callClaudeCadTool("onshape_revolve", { axisSketchFeatureId: "FAxis" }, runtime),
    ).rejects.toThrow(/no straight lines/i);
    expect(calls.some((call) => call.path.endsWith("/features") && call.method === "POST")).toBe(false);
  });

  it("requires the axis sketch to be named", async () => {
    const { runtime } = harness({ session: { ...DOC, lastSketchFeatureId: "FProfile" } });
    await expect(callClaudeCadTool("onshape_revolve", {}, runtime)).rejects.toThrow(
      /axisSketchFeatureId is required/i,
    );
  });
});

describe("onshape_boolean", () => {
  it("subtracts one feature's bodies from another", async () => {
    const { runtime, calls } = harness({ queryIds: ["JBody1"] });
    const result = (await callClaudeCadTool(
      "onshape_boolean",
      { operationType: "SUBTRACT", toolFeatureId: "FCutter", targetFeatureId: "FStock" },
      runtime,
    )) as { featureId: string; featureScriptUsed: boolean };

    expect(result.featureId).toBe("FNew1");
    expect(result.featureScriptUsed).toBe(false);
    expect(postedFeature(calls).featureType).toBe("boolean");
    noFeatureScriptWasWritten(calls);
  });

  it("rejects an operation Onshape does not have", async () => {
    const { runtime } = harness();
    await expect(
      callClaudeCadTool("onshape_boolean", { operationType: "MERGE", toolFeatureId: "FCutter" }, runtime),
    ).rejects.toThrow(/UNION, SUBTRACT, or INTERSECT/i);
  });

  it("will not subtract without knowing what is being cut", async () => {
    const { runtime } = harness({ queryIds: ["JBody1"] });
    await expect(
      callClaudeCadTool("onshape_boolean", { operationType: "SUBTRACT", toolFeatureId: "FCutter" }, runtime),
    ).rejects.toThrow(/targetFeatureId/i);
  });

  it("reports honestly when the named feature made no solid", async () => {
    const { runtime, calls } = harness({ queryIds: [] });
    await expect(
      callClaudeCadTool("onshape_boolean", { operationType: "UNION", toolFeatureId: "FCutter" }, runtime),
    ).rejects.toThrow(/no solid bodies/i);
    expect(calls.some((call) => call.path.endsWith("/features") && call.method === "POST")).toBe(false);
  });
});

describe("onshape_shell", () => {
  it("removes the face pointing the requested way and keeps the wall inward", async () => {
    const { runtime, calls } = harness({ queryIds: ["JTopFace"] });
    const result = (await callClaudeCadTool(
      "onshape_shell",
      { thicknessMm: 2, openFace: "+Z" },
      runtime,
    )) as { featureId: string; faceCount: number; featureScriptUsed: boolean };

    expect(result.faceCount).toBe(1);
    expect(result.featureScriptUsed).toBe(false);
    const posted = postedFeature(calls);
    expect(posted.featureType).toBe("shell");
    // Inward is Onshape's default, so no direction flag should be sent.
    expect(JSON.stringify(posted)).not.toContain("oppositeDirection");
    noFeatureScriptWasWritten(calls);
  });

  it("passes the requested direction through to the face query", async () => {
    const { runtime, calls } = harness({ queryIds: ["JBottomFace"] });
    await callClaudeCadTool("onshape_shell", { thicknessMm: 2, openFace: "-Z" }, runtime);
    const query = calls.find((call) => call.path.includes("/featurescript"));
    expect(query?.body).toContain("vector(0, 0, -1)");
  });

  it("rejects a direction that is not a world axis", async () => {
    const { runtime } = harness({ queryIds: ["JTopFace"] });
    await expect(
      callClaudeCadTool("onshape_shell", { thicknessMm: 2, openFace: "sideways" }, runtime),
    ).rejects.toThrow(/Direction must be one of/i);
  });

  it("does not shell when no face points that way", async () => {
    const { runtime, calls } = harness({ queryIds: [] });
    await expect(callClaudeCadTool("onshape_shell", { thicknessMm: 2, openFace: "+X" }, runtime)).rejects.toThrow(
      /no flat faces pointing \+X/i,
    );
    expect(calls.some((call) => call.path.endsWith("/features") && call.method === "POST")).toBe(false);
  });
});

describe("shellFeature payload", () => {
  it("sends thickness in metres while the human expression stays millimetres", () => {
    const built = shellFeature({ faceIds: ["JFC"], thicknessMm: 2 });
    expect(built.btType).toBe("BTFeatureDefinitionCall-1406");
    expect(built.feature.featureType).toBe("shell");
    const thickness = (built.feature.parameters as Array<Record<string, unknown>>).find(
      (parameter) => parameter.parameterId === "thickness",
    );
    expect(thickness?.value).toBeCloseTo(0.002, 9);
    expect(String(thickness?.expression)).toContain("2");
  });

  it("flips direction only when asked to thicken outward", () => {
    const outward = shellFeature({ faceIds: ["JFC"], thicknessMm: 2, outward: true });
    expect(JSON.stringify(outward)).toContain("oppositeDirection");
  });

  it("refuses to shell without a face to open", () => {
    expect(() => shellFeature({ faceIds: [], thicknessMm: 2 })).toThrow(/faceIds is empty/i);
  });

  it("rejects a thickness that is not a real wall", () => {
    expect(() => shellFeature({ faceIds: ["JFC"], thicknessMm: 0 })).toThrow(/millimetres/i);
  });
});

describe("onshape variables", () => {
  const ELEMENTS = [
    { id: "e1", name: "Part Studio 1", elementType: "PARTSTUDIO" },
    { id: "vs1", name: "Variables", elementType: "VARIABLESTUDIO" },
  ];

  function variableHarness(rows: Array<{ name: string; expression: string; type: string }>) {
    const calls: Call[] = [];
    let session: ClaudeCadSession = { ...DOC };
    const http = async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ path, method, body: String(init?.body ?? "") });
      if (path.endsWith("/elements")) return Response.json(ELEMENTS);
      if (path.includes("/variables")) {
        if (method === "POST") return Response.json({});
        return Response.json([{ variables: rows }]);
      }
      return Response.json({});
    };
    return {
      calls,
      runtime: {
        http,
        hosted: true,
        loadSession: async () => session,
        saveSession: async (next: ClaudeCadSession) => {
          session = next;
        },
      },
    };
  }

  it("reads the Variable Studio, not the bound Part Studio", async () => {
    const { runtime, calls } = variableHarness([{ name: "wallThickness", expression: "3 mm", type: "LENGTH" }]);
    const result = (await callClaudeCadTool("onshape_variable_list", {}, runtime)) as {
      elementId: string;
      variables: Array<{ name: string; expression: string }>;
    };
    expect(result.elementId).toBe("vs1");
    expect(result.variables).toEqual([{ name: "wallThickness", expression: "3 mm", type: "LENGTH" }]);
    expect(calls.some((call) => call.path.includes("/variables/d/d1/w/w1/e/vs1/"))).toBe(true);
  });

  it("writes a named dimension a human can retype later", async () => {
    const { runtime, calls } = variableHarness([{ name: "wallThickness", expression: "3 mm", type: "LENGTH" }]);
    const result = (await callClaudeCadTool(
      "onshape_variable_set",
      { name: "wallThickness", value: "3 mm" },
      runtime,
    )) as { variable: { name: string; expression: string }; featureScriptUsed: boolean };

    expect(result.variable.name).toBe("wallThickness");
    expect(result.variable.expression).toBe("3 mm");
    expect(result.featureScriptUsed).toBe(false);
    const post = calls.find((call) => call.method === "POST" && call.path.includes("/variables"));
    expect(post?.body).toContain("wallThickness");
    expect(post?.body).not.toMatch(/FeatureScript/i);
  });

  it("says how to add a Variable Studio instead of inventing one", async () => {
    const calls: Call[] = [];
    const session: ClaudeCadSession = { ...DOC };
    const runtime = {
      hosted: true,
      http: async (path: string, init?: RequestInit) => {
        calls.push({ path, method: init?.method ?? "GET", body: "" });
        if (path.endsWith("/elements")) {
          return Response.json([{ id: "e1", name: "Part Studio 1", elementType: "PARTSTUDIO" }]);
        }
        return Response.json({});
      },
      loadSession: async () => session,
      saveSession: async () => {},
    };
    await expect(callClaudeCadTool("onshape_variable_list", {}, runtime)).rejects.toThrow(
      /no Variable Studio/i,
    );
    expect(calls.some((call) => call.path.includes("/variables"))).toBe(false);
  });
});
