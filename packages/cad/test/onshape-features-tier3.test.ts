import { describe, expect, it, vi } from "vitest";
import { callClaudeCadTool, type CadExportDestination, type ClaudeCadRuntime } from "../src/claude-cad";
import { CAD_OPERATIONS } from "../src/index";
import { isCadPlanTool, parseCadPlanResponse, CAD_PLAN_MODE_INSTRUCTIONS } from "../src/agent-modes";
import { cadToolSpec, hostedCadToolNames } from "../src/cad-tool-catalog";
import { describeCadToolDryRun, resolvePlanStepReferences } from "../src/cad-tool-dry-run";
import { exportOnshapeElementFile, exportOnshapeStl, exportOnshapeTranslation } from "../src/onshape-export";
import {
  onshapeExportFilename,
  onshapeExternalDataPath,
  onshapeStlExportPath,
  onshapeTranslationPayload,
  polygonSketchFeature,
  shellFeature,
  slotSketchFeature,
  variableFeature,
} from "../src/onshape-features";
import { planarFacesScript, resolveOnshapeFaceIds } from "../src/onshape-resolve";
import { legacyOperationToolCalls, legacyParameterMm } from "../src/onshape";
import type { ClaudeCadSession } from "../src/claude-session";

type AnyParam = { btType: string; parameterId: string; queries?: Array<Record<string, unknown>>; [key: string]: unknown };

function params(payload: { feature: { parameters?: unknown } }): AnyParam[] {
  return (payload.feature.parameters ?? []) as AnyParam[];
}

function param(payload: { feature: { parameters?: unknown } }, parameterId: string): AnyParam {
  const found = params(payload).find((entry) => entry.parameterId === parameterId);
  if (!found) throw new Error(`missing parameter ${parameterId}`);
  return found;
}

describe("tier-3 sketch primitives", () => {
  it("builds a straight slot from two lines and two semicircular arcs, in metres", () => {
    const slot = slotSketchFeature({ lengthMm: 40, widthMm: 8, centerXMm: 10, centerYMm: 0 });
    const entities = slot.feature.entities as Array<Record<string, unknown>>;
    expect(entities).toHaveLength(4);
    const arcs = entities.filter((entity) => (entity.geometry as { btType: string }).btType === "BTCurveGeometryCircle-115");
    const lines = entities.filter((entity) => (entity.geometry as { btType: string }).btType === "BTCurveGeometryLine-117");
    expect(arcs).toHaveLength(2);
    expect(lines).toHaveLength(2);
    for (const arc of arcs) {
      const geometry = arc.geometry as { radius: number };
      expect(geometry.radius).toBeCloseTo(0.004, 10);
      // Semicircle: the two params span exactly pi radians.
      expect(Math.abs((arc.endParam as number) - (arc.startParam as number))).toBeCloseTo(Math.PI, 10);
    }
    // End centres sit (length - width) / 2 = 16 mm either side of the slot centre.
    const centres = arcs.map((arc) => (arc.geometry as { xCenter: number }).xCenter).sort((a, b) => a - b);
    expect(centres[0]).toBeCloseTo(-0.006, 10);
    expect(centres[1]).toBeCloseTo(0.026, 10);
    expect(() => slotSketchFeature({ lengthMm: 8, widthMm: 8 })).toThrow(/greater than its widthMm/);
  });

  it("builds a hexagon from across-flats and rejects silly side counts", () => {
    const hex = polygonSketchFeature({ sides: 6, acrossFlatsMm: 12.7 });
    const entities = hex.feature.entities as Array<Record<string, unknown>>;
    expect(entities).toHaveLength(6);
    // Circumradius of a hex = (AF / 2) / cos(30°): 6.35 / 0.866 = 7.332 mm.
    const first = entities[0]!.geometry as { pntX: number; pntY: number };
    expect(Math.hypot(first.pntX, first.pntY)).toBeCloseTo(0.007332, 5);
    const square = polygonSketchFeature({ sides: 4, circumscribedDiameterMm: 20 });
    expect(square.feature.entities).toHaveLength(4);
    expect(() => polygonSketchFeature({ sides: 2, acrossFlatsMm: 10 })).toThrow(/between 3 and 24/);
    expect(() => polygonSketchFeature({ sides: 6 })).toThrow(/circumscribedDiameterMm|acrossFlatsMm/);
  });
});

describe("tier-3 solid features", () => {
  it("builds a shell with explicit faces, thickness in metres and isHollow=false", () => {
    const shell = shellFeature({ faceIds: ["JFT"], thicknessMm: 2 });
    expect(shell.feature.featureType).toBe("shell");
    expect(param(shell, "isHollow").value).toBe(false);
    expect(param(shell, "entities").queries).toEqual([{ btType: "BTMIndividualQuery-138", deterministicIds: ["JFT"] }]);
    expect(param(shell, "thickness").value).toBeCloseTo(0.002, 10);
    expect(param(shell, "thickness").expression).toBe("2 mm");
    expect(() => shellFeature({ faceIds: [], thicknessMm: 2 })).toThrow(/never guesses/i);
  });

  it("builds a Variable feature for LENGTH, ANGLE and NUMBER and validates the name", () => {
    const length = variableFeature({ name: "wallThickness", value: 3 });
    expect(length.feature.featureType).toBe("assignVariable");
    expect(length.feature.name).toBe("#wallThickness");
    expect(param(length, "name")).toMatchObject({ btType: "BTMParameterString-149", value: "wallThickness" });
    expect(param(length, "variableType")).toMatchObject({ enumName: "VariableType", value: "LENGTH" });
    expect(param(length, "value").value).toBeCloseTo(0.003, 10);
    expect(param(length, "value").expression).toBe("3 mm");

    const angle = variableFeature({ name: "tilt", value: 15, variableType: "ANGLE" });
    expect(param(angle, "value").expression).toBe("15 deg");
    const count = variableFeature({ name: "holes", value: 4, variableType: "NUMBER" });
    expect(param(count, "value")).toMatchObject({ value: 4, expression: "4" });

    expect(() => variableFeature({ name: "1bad", value: 1 })).toThrow(/not a valid Onshape variable name/);
    expect(() => variableFeature({ name: "x", value: Number.NaN })).toThrow(/numeric value/);
  });
});

describe("face resolution for shells", () => {
  it("emits a FeatureScript that keeps planar faces by normal direction", () => {
    const script = planarFacesScript("FExtrude", [0, 0, 1], "positive");
    expect(script).toContain('qCreatedBy(makeId("FExtrude"), EntityType.FACE)');
    expect(script).toContain("GeometryType.PLANE");
    expect(script).toContain("d > 0.99");
    expect(planarFacesScript("F", [0, 0, 1], "negative")).toContain("d < -0.99");
    expect(planarFacesScript("F", [0, 0, 1], "either")).toContain("abs(d) > 0.99");
    expect(() => planarFacesScript("bad id!", [0, 0, 1])).toThrow(/not a valid Onshape feature id/);
  });

  it("returns [] rather than throwing when Onshape matches nothing", async () => {
    const http = vi.fn(async () => Response.json({ result: { btType: "BTFSValueArray-2125", value: [] } }));
    const ids = await resolveOnshapeFaceIds(http, { documentId: "d", workspaceId: "w", elementId: "e" }, { featureId: "F1", selection: "top" });
    expect(ids).toEqual([]);
    await expect(
      resolveOnshapeFaceIds(http, { documentId: "d", workspaceId: "w", elementId: "e" }, { featureId: "F1", selection: "sideways" as never }),
    ).rejects.toThrow(/faces must be one of/);
  });
});

describe("export paths and payloads", () => {
  it("builds the synchronous STL path and the translation payloads", () => {
    const doc = { documentId: "d1", workspaceId: "w1", elementId: "e1" };
    expect(onshapeStlExportPath(doc)).toBe("/partstudios/d/d1/w/w1/e/e1/stl?mode=binary&grouping=true&scale=1&units=millimeter");
    expect(onshapeTranslationPayload("STEP")).toEqual({ formatName: "STEP", storeInDocument: false, translate: true });
    expect(onshapeTranslationPayload("GLTF", "d1")).toMatchObject({ linkDocumentId: "d1" });
    expect(onshapeExternalDataPath("d1", "x/y")).toBe("/documents/d/d1/externaldata/x%2Fy");
    expect(onshapeExportFilename("Drive plate (left)", "stl")).toBe("Drive-plate-left.stl");
    expect(onshapeExportFilename(undefined, "step")).toBe("part-studio.step");
  });

  it("downloads STL bytes and hashes them", async () => {
    const stl = Buffer.alloc(84 + 50); // binary header + count + one triangle
    stl.write("VANTAGE", 0);
    const http = vi.fn(async (path: string) => {
      expect(path).toContain("/stl?mode=binary");
      return new Response(stl, { status: 200, headers: { "content-type": "application/octet-stream" } });
    });
    const file = await exportOnshapeStl(http, { documentId: "d", workspaceId: "w", elementId: "e" }, { elementName: "Plate" });
    expect(file.format).toBe("stl");
    expect(file.filename).toBe("Plate.stl");
    expect(file.byteLength).toBe(134);
    expect(file.sha256).toHaveLength(64);
  });

  it("refuses an STL answer that is JSON rather than bytes", async () => {
    const http = vi.fn(async () => Response.json({ message: "export disabled" }));
    await expect(exportOnshapeStl(http, { documentId: "d", workspaceId: "w", elementId: "e" })).rejects.toThrow(/JSON instead of STL/);
  });

  it("polls a STEP translation and downloads the external data without really sleeping", async () => {
    const states = ["ACTIVE", "ACTIVE", "DONE"];
    let polls = 0;
    const http = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/translations") && init?.method === "POST") {
        return Response.json({ id: "tr-9", requestState: "ACTIVE" });
      }
      if (path === "/translations/tr-9") {
        const state = states[Math.min(polls, states.length - 1)]!;
        polls += 1;
        return Response.json(state === "DONE" ? { requestState: state, resultExternalDataIds: ["ext-9"] } : { requestState: state });
      }
      if (path === "/documents/d/d/externaldata/ext-9") {
        return new Response("ISO-10303-21;", { status: 200, headers: { "content-type": "application/octet-stream" } });
      }
      return Response.json({ message: `unexpected ${path}` }, { status: 404 });
    });
    const sleep = vi.fn(async () => undefined);
    const file = await exportOnshapeTranslation(http, { documentId: "d", workspaceId: "w", elementId: "e" }, "STEP", { sleep, pollMs: 1 });
    expect(file.format).toBe("step");
    expect(file.translationId).toBe("tr-9");
    expect(file.bytes.toString("utf8")).toBe("ISO-10303-21;");
    expect(polls).toBe(3);
    expect(sleep).toHaveBeenCalled();
  });

  it("reports a FAILED translation instead of waiting forever", async () => {
    const http = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") return Response.json({ id: "tr-f", requestState: "ACTIVE" });
      return Response.json({ requestState: "FAILED", failureReason: "empty part studio" });
    });
    await expect(
      exportOnshapeElementFile(http, { documentId: "d", workspaceId: "w", elementId: "e" }, "step", { sleep: async () => undefined }),
    ).rejects.toThrow(/did not finish \(state=FAILED: empty part studio\)/);
  });
});

describe("agent export tools", () => {
  function runtimeWith(session: ClaudeCadSession, http: ClaudeCadRuntime["http"], saveExport?: ClaudeCadRuntime["saveExport"]): ClaudeCadRuntime {
    let current = session;
    return {
      http,
      hosted: true,
      loadSession: async () => current,
      saveSession: async (next) => {
        current = next;
      },
      saveExport,
    };
  }

  it("hands STL bytes to the vault sink and narrates where the file went", async () => {
    const http = vi.fn(async () => new Response(Buffer.alloc(100), { status: 200, headers: { "content-type": "application/octet-stream" } }));
    const sink = vi.fn(async (): Promise<CadExportDestination> => ({
      kind: "vault",
      documentId: "doc-1",
      version: 3,
      href: "/cad-vault?orgId=o&document=doc-1",
      duplicate: false,
      title: "Drive plate",
    }));
    const result = (await callClaudeCadTool(
      "onshape_export_stl",
      { title: "Drive plate", changeNote: "from agent" },
      runtimeWith({ documentId: "d", workspaceId: "w", elementId: "e", elementName: "Drive plate" }, http, sink),
    )) as { ok: boolean; destination: CadExportDestination; narration: { title: string; detail: string }; sha256: string };
    expect(result.ok).toBe(true);
    expect(result.destination).toMatchObject({ kind: "vault", version: 3 });
    expect(result.narration.title).toMatch(/Saved STL .* to the vault as "Drive plate" v3/);
    expect(result.narration.detail).toBe("/cad-vault?orgId=o&document=doc-1");
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Drive plate", changeNote: "from agent", file: expect.objectContaining({ format: "stl", byteLength: 100 }) }),
    );
  });

  it("refuses to export without a bound Part Studio", async () => {
    const http = vi.fn(async () => Response.json({}));
    await expect(callClaudeCadTool("onshape_export_step", {}, runtimeWith({}, http))).rejects.toThrow(/No Part Studio bound/);
    expect(http).not.toHaveBeenCalled();
  });

  it("shell resolves top faces then posts the shell feature", async () => {
    const posted: string[] = [];
    const http = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/featurescript")) {
        return Response.json({ result: { btType: "BTFSValueArray-2125", value: [{ btType: "BTFSValueString-1358", value: "JFTOP" }] } });
      }
      if (path.endsWith("/features") && init?.method === "POST") {
        posted.push(String(init.body));
        return Response.json({ feature: { featureId: "FShell" } });
      }
      return Response.json({}, { status: 404 });
    });
    const session: ClaudeCadSession = {
      documentId: "d",
      workspaceId: "w",
      elementId: "e",
      features: [{ featureId: "FBox", kind: "solid", tool: "onshape_extrude", name: "box", plane: "Top", at: "" }],
    };
    const result = (await callClaudeCadTool("onshape_shell", { thicknessMm: 2 }, runtimeWith(session, http))) as {
      featureId: string;
      faceCount: number;
      narration: { title: string };
    };
    expect(result.featureId).toBe("FShell");
    expect(result.faceCount).toBe(1);
    expect(result.narration.title).toMatch(/Shelled to 2 mm walls, removing 1 top face/);
    expect(posted[0]).toContain('"featureType":"shell"');
    expect(posted[0]).toContain("JFTOP");
  });

  it("set_variable posts an assignVariable feature and records it on the session", async () => {
    const http = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/features") && init?.method === "POST") {
        expect(String(init.body)).toContain('"featureType":"assignVariable"');
        return Response.json({ feature: { featureId: "FVar" } });
      }
      return Response.json({}, { status: 404 });
    });
    const result = (await callClaudeCadTool(
      "onshape_set_variable",
      { variableName: "wall", value: 3 },
      runtimeWith({ documentId: "d", workspaceId: "w", elementId: "e" }, http),
    )) as { featureId: string; narration: { title: string } };
    expect(result.featureId).toBe("FVar");
    expect(result.narration.title).toBe("Set #wall = 3 mm");
  });
});

describe("plan-mode dry runs and references", () => {
  it("describes every hosted mutating tool without touching Onshape", () => {
    for (const name of hostedCadToolNames()) {
      const line = describeCadToolDryRun(name, {});
      expect(line, name).toBeTruthy();
      expect(line).not.toMatch(/not a tool the hosted agent can run/);
    }
    expect(describeCadToolDryRun("onshape_sketch_rectangle", { widthMm: 80, heightMm: 50 })).toBe(
      "Sketch a 80 mm × 50 mm rectangle on Top from the origin.",
    );
    expect(describeCadToolDryRun("onshape_hole", { diameterMm: 5 })).toMatch(/Drill ⌀5 mm through holes at the points of the last point sketch/);
    expect(describeCadToolDryRun("onshape_shell", { thicknessMm: 2, faces: "ends" })).toMatch(/top and bottom faces/);
    expect(describeCadToolDryRun("fusion_extrude", {})).toMatch(/not a tool the hosted agent can run/);
  });

  it("resolves {{step:N.featureId}} references and refuses unknown ones", () => {
    const outputs = new Map<number, string>([[1, "FSketch"]]);
    expect(resolvePlanStepReferences({ sketchFeatureId: "{{step:1.featureId}}", depthMm: 6, nested: { ids: ["{{ step:1.featureId }}"] } }, outputs)).toEqual({
      sketchFeatureId: "FSketch",
      depthMm: 6,
      nested: { ids: ["FSketch"] },
    });
    expect(() => resolvePlanStepReferences({ featureId: "{{step:2.featureId}}" }, outputs)).toThrow(/references step 2/);
    expect(resolvePlanStepReferences({ plane: "Top" }, outputs)).toEqual({ plane: "Top" });
  });

  it("parses a tool-call plan with args, rationale and a dry run per step", () => {
    const plan = parseCadPlanResponse(
      JSON.stringify({
        plan: {
          steps: [
            { tool: "onshape_sketch_rectangle", args: { widthMm: 80, heightMm: 50, plane: "Top" }, title: "Plate outline", rationale: "stock" },
            { tool: "onshape_extrude", args: { depthMm: 6 } },
            { title: "Ask the mentor about hole spacing" },
          ],
          questions: ["Hole pitch?"],
        },
      }),
    );
    expect(plan?.steps).toHaveLength(3);
    expect(plan?.steps[0]).toMatchObject({ index: 1, tool: "onshape_sketch_rectangle", args: { widthMm: 80 }, detail: "stock" });
    expect(plan?.steps[0]?.dryRun).toMatch(/80 mm × 50 mm rectangle on Top/);
    expect(plan?.steps[1]?.title).toBe("extrude");
    expect(plan?.steps[2]?.tool).toBeUndefined();
    expect(plan?.questions).toEqual(["Hole pitch?"]);
    expect(isCadPlanTool("onshape_extrude")).toBe(true);
    expect(isCadPlanTool("fusion_extrude")).toBe(false);
    expect(CAD_PLAN_MODE_INSTRUCTIONS).toContain("{{step:N.featureId}}");
  });
});

describe("legacy pipeline honesty", () => {
  it("maps every allowlisted CAD_OPERATION to real tool calls or a transport branch", () => {
    const transportBranches = new Set(["feature_script", "verify_topology", "render_views", "create_checkpoint", "export_step", "export_stl", "export_gltf"]);
    for (const operation of CAD_OPERATIONS) {
      if (transportBranches.has(operation)) continue;
      const calls = legacyOperationToolCalls(operation, {});
      expect(calls.length, operation).toBeGreaterThan(0);
      for (const call of calls) expect(cadToolSpec(call.tool)?.onshape, `${operation} -> ${call.tool}`).toBe("supported");
    }
    expect(CAD_OPERATIONS).not.toContain("create_assembly");
    expect(CAD_OPERATIONS).not.toContain("rollback_checkpoint");
  });

  it("converts legacy unit strings to millimetres", () => {
    expect(legacyParameterMm("25 mm")).toBe(25);
    expect(legacyParameterMm("1 in")).toBeCloseTo(25.4, 10);
    expect(legacyParameterMm('0.5"')).toBeCloseTo(12.7, 10);
    expect(legacyParameterMm("2.5cm")).toBe(25);
    expect(legacyParameterMm(6)).toBe(6);
    expect(legacyParameterMm(undefined)).toBeUndefined();
    expect(Number.isNaN(legacyParameterMm("confirmed by user"))).toBe(true);
  });

  it("maps create_hole with a grid to points + hole, and circular patterns by axis", () => {
    const hole = legacyOperationToolCalls("create_hole", { gridCountX: 4, pitch: "20 mm", diameter: "5 mm" });
    expect(hole.map((call) => call.tool)).toEqual(["onshape_sketch_points", "onshape_hole"]);
    expect(hole[0]?.args).toMatchObject({ gridCountX: 4, gridPitchXMm: 20 });
    expect(hole[1]?.args).toMatchObject({ diameterMm: 5 });
    expect(legacyOperationToolCalls("create_pattern", { count: 3, axisFeatureId: "FBore" })[0]?.tool).toBe("onshape_circular_pattern");
    expect(legacyOperationToolCalls("create_pattern", { count: 3, spacing: "25 mm", direction: "x" })[0]?.args).toMatchObject({
      instanceCount: 3,
      spacingMm: 25,
      direction: "X",
    });
  });
});
