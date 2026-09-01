import { describe, expect, it, vi } from "vitest";
import {
  chamferFeature,
  circleSketchFeature,
  extrudeFeature,
  filletFeature,
  holeFeature,
  quantityParameter,
  rectangleSketchFeature,
} from "../src/onshape-features";
import {
  applyNativeFeatureDimensions,
  requireCreatedOnshapeFeatureId,
  updateOnshapeFeature,
  type OnshapeUpdateFeatureHttp,
} from "../src/onshape-update-feature";

const DOCUMENT = { documentId: "d1", workspaceId: "w1", elementId: "e1" };
const CREATED_EXTRUDE_ID = "FWxExtrude1";
const CREATED_SKETCH_ID = "FWxSketch1";
const CREATED_FILLET_ID = "FWxFillet1";
const CREATED_CHAMFER_ID = "FWxChamfer1";
const CREATED_HOLE_ID = "FWxHole1";
const CREATED_SHELL_ID = "FWxShell1";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function captureHttp(handler: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ path: string; method: string; body: Record<string, unknown> | null }> = [];
  const http = vi.fn(async (path: string, init?: RequestInit) => {
    let body: Record<string, unknown> | null = null;
    if (typeof init?.body === "string" && init.body) {
      body = JSON.parse(init.body) as Record<string, unknown>;
    }
    calls.push({ path, method: (init?.method ?? "GET").toUpperCase(), body });
    return handler(path, init);
  }) as unknown as OnshapeUpdateFeatureHttp;
  return { http, calls };
}

function extrudeExisting(featureId = CREATED_EXTRUDE_ID) {
  return {
    feature: {
      ...extrudeFeature({ sketchFeatureId: CREATED_SKETCH_ID, depthMm: 6, name: "VantageExtrude" }).feature,
      featureId,
    },
    sourceMicroversion: "mv-create-1",
    serializationVersion: "1.1.22",
  };
}

function sketchExisting(featureId = CREATED_SKETCH_ID) {
  return {
    feature: {
      ...rectangleSketchFeature({ widthMm: 80, heightMm: 50, plane: "Top", name: "VantageSketch" }).feature,
      featureId,
    },
    sourceMicroversion: "mv-create-1",
    serializationVersion: "1.1.22",
  };
}

function circleSketchExisting(featureId = CREATED_SKETCH_ID) {
  return {
    feature: {
      ...circleSketchFeature({
        name: "VantageCircles",
        plane: "Top",
        circles: [{ diameterMm: 20, centerXMm: 0, centerYMm: 0 }],
      }).feature,
      featureId,
    },
    sourceMicroversion: "mv-create-1",
    serializationVersion: "1.1.22",
  };
}

function filletExisting(featureId = CREATED_FILLET_ID) {
  return {
    feature: {
      ...filletFeature({ edgeIds: ["JHD"], radiusMm: 3, name: "VantageFillet" }).feature,
      featureId,
    },
    sourceMicroversion: "mv-create-1",
    serializationVersion: "1.1.22",
  };
}

function chamferExisting(featureId = CREATED_CHAMFER_ID) {
  return {
    feature: {
      ...chamferFeature({ edgeIds: ["JHD"], widthMm: 2, name: "VantageChamfer" }).feature,
      featureId,
    },
    sourceMicroversion: "mv-create-1",
    serializationVersion: "1.1.22",
  };
}

function holeExisting(featureId = CREATED_HOLE_ID) {
  return {
    feature: {
      ...holeFeature({
        locationIds: ["V1"],
        scopeIds: ["B1"],
        diameterMm: 5,
        name: "VantageHole",
      }).feature,
      featureId,
    },
    sourceMicroversion: "mv-create-1",
    serializationVersion: "1.1.22",
  };
}

function holeWithDiameterParam(featureId = CREATED_HOLE_ID) {
  const existing = holeExisting(featureId);
  const parameters = (existing.feature.parameters as Array<Record<string, unknown>>).map((entry) =>
    String(entry.parameterId) === "holeDiameter" ? { ...quantityParameter("diameter", 5, 0.005) } : entry,
  );
  return { ...existing, feature: { ...existing.feature, parameters } };
}

function shellExisting(featureId = CREATED_SHELL_ID) {
  return {
    feature: {
      btType: "BTMFeature-134",
      featureType: "shell",
      name: "VantageShell",
      featureId,
      suppressed: false,
      namespace: "",
      parameters: [quantityParameter("thickness", 2, 0.002)],
    },
    sourceMicroversion: "mv-create-1",
    serializationVersion: "1.1.22",
  };
}

function quantityOf(feature: Record<string, unknown>, parameterId: string) {
  return (feature.parameters as Array<Record<string, unknown>>).find((entry) => entry.parameterId === parameterId);
}

describe("requireCreatedOnshapeFeatureId", () => {
  it("accepts the id Onshape returned from a prior create", () => {
    expect(requireCreatedOnshapeFeatureId(CREATED_EXTRUDE_ID)).toBe(CREATED_EXTRUDE_ID);
  });

  it("refuses empty ids without calling Onshape", () => {
    expect(() => requireCreatedOnshapeFeatureId("")).toThrow(/featureId Onshape returned/i);
    expect(() => requireCreatedOnshapeFeatureId("   ")).toThrow(/featureId Onshape returned/i);
    expect(() => requireCreatedOnshapeFeatureId(undefined)).toThrow(/featureId Onshape returned/i);
  });

  it("refuses DEMO ids without calling Onshape", () => {
    expect(() => requireCreatedOnshapeFeatureId("DEMO")).toThrow(/DEMO/i);
    expect(() => requireCreatedOnshapeFeatureId("demo-1")).toThrow(/DEMO/i);
    expect(() => requireCreatedOnshapeFeatureId("DEMO_FEATURE")).toThrow(/DEMO/i);
  });
});

describe("applyNativeFeatureDimensions", () => {
  it("patches extrude depth in millimetres", () => {
    const updated = applyNativeFeatureDimensions(extrudeExisting().feature, { depthMm: 12 });
    const depth = (updated.parameters as Array<Record<string, unknown>>).find(
      (entry) => entry.parameterId === "depth",
    );
    expect(depth?.expression).toBe("12 mm");
    expect(depth?.value).toBeCloseTo(0.012, 10);
  });

  it("rebuilds rectangle sketch width and keeps height", () => {
    const updated = applyNativeFeatureDimensions(sketchExisting().feature, { widthMm: 120 });
    const entities = updated.entities as Array<Record<string, unknown>>;
    const bottom = entities.find((entry) => entry.entityId === "rect.bottom");
    expect(bottom?.endParam).toBeCloseTo(0.12, 10);
    const right = entities.find((entry) => entry.entityId === "rect.right");
    expect(right?.endParam).toBeCloseTo(0.05, 10);
  });

  it("patches fillet radius in millimetres", () => {
    const updated = applyNativeFeatureDimensions(filletExisting().feature, { radiusMm: 4 });
    const radius = quantityOf(updated, "radius");
    expect(radius?.expression).toBe("4 mm");
    expect(radius?.value).toBeCloseTo(0.004, 10);
  });

  it("patches chamfer width in millimetres", () => {
    const updated = applyNativeFeatureDimensions(chamferExisting().feature, { widthMm: 3 });
    const width = quantityOf(updated, "width");
    expect(width?.expression).toBe("3 mm");
    expect(width?.value).toBeCloseTo(0.003, 10);
  });

  it("patches hole holeDiameter when that is the existing quantity id", () => {
    const updated = applyNativeFeatureDimensions(holeExisting().feature, { diameterMm: 8 });
    const diameter = quantityOf(updated, "holeDiameter");
    expect(quantityOf(updated, "diameter")).toBeUndefined();
    expect(diameter?.expression).toBe("8 mm");
    expect(diameter?.value).toBeCloseTo(0.008, 10);
  });

  it("patches hole diameter when the feature uses the diameter parameterId", () => {
    const updated = applyNativeFeatureDimensions(holeWithDiameterParam().feature, { diameterMm: 8 });
    const diameter = quantityOf(updated, "diameter");
    expect(quantityOf(updated, "holeDiameter")).toBeUndefined();
    expect(diameter?.expression).toBe("8 mm");
    expect(diameter?.value).toBeCloseTo(0.008, 10);
  });

  it("patches shell thickness in millimetres", () => {
    const updated = applyNativeFeatureDimensions(shellExisting().feature, { thicknessMm: 1.5 });
    const thickness = quantityOf(updated, "thickness");
    expect(thickness?.expression).toBe("1.5 mm");
    expect(thickness?.value).toBeCloseTo(0.0015, 10);
  });

  it("rebuilds a circle sketch from radiusMm instead of requiring width and height", () => {
    const updated = applyNativeFeatureDimensions(circleSketchExisting().feature, { radiusMm: 15 });
    expect(JSON.stringify(updated)).toContain("BTCurveGeometryCircle-115");
    expect(JSON.stringify(updated)).toContain("0.015");
    expect(JSON.stringify(updated)).not.toContain("rect.bottom");
  });

  it("does not rebuild a circle when only leftover radius is on a rectangle update", () => {
    const updated = applyNativeFeatureDimensions(sketchExisting().feature, { widthMm: 90, heightMm: 50 });
    expect(JSON.stringify(updated)).toContain("rect.bottom");
    expect(JSON.stringify(updated)).not.toContain("BTCurveGeometryCircle-115");
  });
});

describe("updateOnshapeFeature", () => {
  it("updates extrude depth through GET + POST and returns Onshape's feature id", async () => {
    const { http, calls } = captureHttp((path, init) => {
      if (path.includes(`/features/featureid/${CREATED_EXTRUDE_ID}`) && !init?.method) {
        return jsonResponse(extrudeExisting());
      }
      if (path.includes(`/features/featureid/${CREATED_EXTRUDE_ID}`) && init?.method === "POST") {
        return jsonResponse({ feature: { featureId: CREATED_EXTRUDE_ID } });
      }
      return jsonResponse({ message: `unexpected ${init?.method ?? "GET"} ${path}` }, 404);
    });

    const result = await updateOnshapeFeature(http, {
      document: DOCUMENT,
      featureId: CREATED_EXTRUDE_ID,
      depthMm: 12,
    });

    expect(result).toEqual({ featureId: CREATED_EXTRUDE_ID, featureScriptUsed: false });
    expect(calls).toEqual([
      expect.objectContaining({
        method: "GET",
        path: `/partstudios/d/d1/w/w1/e/e1/features/featureid/${CREATED_EXTRUDE_ID}`,
      }),
      expect.objectContaining({
        method: "POST",
        path: `/partstudios/d/d1/w/w1/e/e1/features/featureid/${CREATED_EXTRUDE_ID}`,
      }),
    ]);
    expect(JSON.stringify(calls[1]?.body)).toContain('"expression":"12 mm"');
    expect(JSON.stringify(calls[1]?.body)).toContain(CREATED_EXTRUDE_ID);
    expect(calls.some((call) => call.path.includes("featurescript"))).toBe(false);
    expect(JSON.stringify(calls)).not.toMatch(/cad_part_edit/);
  });

  it("updates sketch width on the created feature and returns Onshape's id", async () => {
    const { http, calls } = captureHttp((path, init) => {
      if (path.includes(`/features/featureid/${CREATED_SKETCH_ID}`) && !init?.method) {
        return jsonResponse(sketchExisting());
      }
      if (path.includes(`/features/featureid/${CREATED_SKETCH_ID}`) && init?.method === "POST") {
        return jsonResponse({ feature: { message: { featureId: CREATED_SKETCH_ID } } });
      }
      return jsonResponse({ message: "unexpected" }, 404);
    });

    const result = await updateOnshapeFeature(http, {
      document: DOCUMENT,
      featureId: CREATED_SKETCH_ID,
      widthMm: 100,
    });

    expect(result.featureId).toBe(CREATED_SKETCH_ID);
    expect(result.featureScriptUsed).toBe(false);
    expect(JSON.stringify(calls[1]?.body)).toContain("rect.bottom");
    expect(JSON.stringify(calls[1]?.body)).toContain("0.1");
  });

  it("updates fillet radius through GET + POST and never calls FeatureScript", async () => {
    const { http, calls } = captureHttp((path, init) => {
      if (path.includes(`/features/featureid/${CREATED_FILLET_ID}`) && !init?.method) {
        return jsonResponse(filletExisting());
      }
      if (path.includes(`/features/featureid/${CREATED_FILLET_ID}`) && init?.method === "POST") {
        return jsonResponse({ feature: { featureId: CREATED_FILLET_ID } });
      }
      return jsonResponse({ message: `unexpected ${init?.method ?? "GET"} ${path}` }, 404);
    });

    const result = await updateOnshapeFeature(http, {
      document: DOCUMENT,
      featureId: CREATED_FILLET_ID,
      radiusMm: 4,
    });

    expect(result).toEqual({ featureId: CREATED_FILLET_ID, featureScriptUsed: false });
    expect(JSON.stringify(calls[1]?.body)).toContain('"parameterId":"radius"');
    expect(JSON.stringify(calls[1]?.body)).toContain('"expression":"4 mm"');
    expect(calls.some((call) => call.path.includes("featurescript"))).toBe(false);
    expect(JSON.stringify(calls)).not.toMatch(/cad_part_edit|opFillet|FeatureScript/);
  });

  it("updates hole diameter through GET + POST and never calls FeatureScript", async () => {
    const { http, calls } = captureHttp((path, init) => {
      if (!init?.method) return jsonResponse(holeExisting());
      return jsonResponse({ feature: { featureId: CREATED_HOLE_ID } });
    });

    const result = await updateOnshapeFeature(http, {
      document: DOCUMENT,
      featureId: CREATED_HOLE_ID,
      diameterMm: 8,
    });

    expect(result).toEqual({ featureId: CREATED_HOLE_ID, featureScriptUsed: false });
    expect(JSON.stringify(calls[1]?.body)).toContain('"parameterId":"holeDiameter"');
    expect(JSON.stringify(calls[1]?.body)).toContain('"expression":"8 mm"');
    expect(calls.some((call) => call.path.includes("featurescript"))).toBe(false);
  });

  it("updates chamfer width and shell thickness through GET + POST", async () => {
    const { http: chamferHttp, calls: chamferCalls } = captureHttp((path, init) => {
      if (!init?.method) return jsonResponse(chamferExisting());
      return jsonResponse({ feature: { featureId: CREATED_CHAMFER_ID } });
    });
    const chamfer = await updateOnshapeFeature(chamferHttp, {
      document: DOCUMENT,
      featureId: CREATED_CHAMFER_ID,
      widthMm: 3,
    });
    expect(chamfer).toEqual({ featureId: CREATED_CHAMFER_ID, featureScriptUsed: false });
    expect(JSON.stringify(chamferCalls[1]?.body)).toContain('"parameterId":"width"');
    expect(JSON.stringify(chamferCalls[1]?.body)).toContain('"expression":"3 mm"');

    const { http: shellHttp, calls: shellCalls } = captureHttp((path, init) => {
      if (!init?.method) return jsonResponse(shellExisting());
      return jsonResponse({ feature: { featureId: CREATED_SHELL_ID } });
    });
    const shell = await updateOnshapeFeature(shellHttp, {
      document: DOCUMENT,
      featureId: CREATED_SHELL_ID,
      thicknessMm: 1.5,
    });
    expect(shell).toEqual({ featureId: CREATED_SHELL_ID, featureScriptUsed: false });
    expect(JSON.stringify(shellCalls[1]?.body)).toContain('"parameterId":"thickness"');
    expect(JSON.stringify(shellCalls[1]?.body)).toContain('"expression":"1.5 mm"');
    expect(shellCalls.some((call) => call.path.includes("featurescript"))).toBe(false);
  });

  it("refuses empty and DEMO ids without HTTP", async () => {
    const http = vi.fn(async () => jsonResponse({ featureId: "should-not-run" })) as unknown as OnshapeUpdateFeatureHttp;
    await expect(updateOnshapeFeature(http, { document: DOCUMENT, featureId: "", depthMm: 8 })).rejects.toThrow(
      /featureId Onshape returned/i,
    );
    await expect(updateOnshapeFeature(http, { document: DOCUMENT, featureId: "DEMO", depthMm: 8 })).rejects.toThrow(
      /DEMO/i,
    );
    await expect(updateOnshapeFeature(http, { document: DOCUMENT, featureId: "demo-plate", widthMm: 40 })).rejects.toThrow(
      /DEMO/i,
    );
    await expect(updateOnshapeFeature(http, { document: DOCUMENT, featureId: "DEMO_FEATURE", radiusMm: 3 })).rejects.toThrow(
      /DEMO/i,
    );
    await expect(updateOnshapeFeature(http, { document: DOCUMENT, featureId: "demo-hole", diameterMm: 5 })).rejects.toThrow(
      /DEMO/i,
    );
    await expect(updateOnshapeFeature(http, { document: DOCUMENT, featureId: "DEMO-shell", thicknessMm: 2 })).rejects.toThrow(
      /DEMO/i,
    );
    expect(http).not.toHaveBeenCalled();
  });

  it("does not invent a feature id when the prior create is missing", async () => {
    const { http, calls } = captureHttp(() => jsonResponse({ message: "not found" }, 404));
    await expect(
      updateOnshapeFeature(http, { document: DOCUMENT, featureId: CREATED_EXTRUDE_ID, depthMm: 8 }),
    ).rejects.toThrow(/not found/i);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
  });

  it("does not invent a feature id when Onshape omits one on update", async () => {
    const { http } = captureHttp((path, init) => {
      if (!init?.method) return jsonResponse(extrudeExisting());
      return jsonResponse({ ok: true });
    });
    await expect(
      updateOnshapeFeature(http, { document: DOCUMENT, featureId: CREATED_EXTRUDE_ID, depthMm: 8 }),
    ).rejects.toThrow(/did not return a feature id/i);
  });

  it("does not invent a feature id when Onshape rejects the update", async () => {
    const { http } = captureHttp((path, init) => {
      if (!init?.method) return jsonResponse(extrudeExisting());
      return jsonResponse({ message: "microversion skew" }, 409);
    });
    await expect(
      updateOnshapeFeature(http, { document: DOCUMENT, featureId: CREATED_EXTRUDE_ID, depthMm: 8 }),
    ).rejects.toThrow(/microversion skew/);
  });

  it("refuses a re-run that has no millimetre patch", async () => {
    const http = vi.fn(async () => jsonResponse(extrudeExisting())) as unknown as OnshapeUpdateFeatureHttp;
    await expect(updateOnshapeFeature(http, { document: DOCUMENT, featureId: CREATED_EXTRUDE_ID })).rejects.toThrow(
      /depthMm.*widthMm.*radiusMm.*diameterMm.*thicknessMm/i,
    );
    expect(http).not.toHaveBeenCalled();
  });

  it("refuses non-positive millimetre patches without HTTP", async () => {
    const http = vi.fn(async () => jsonResponse(filletExisting())) as unknown as OnshapeUpdateFeatureHttp;
    await expect(
      updateOnshapeFeature(http, { document: DOCUMENT, featureId: CREATED_FILLET_ID, radiusMm: 0 }),
    ).rejects.toThrow(/millimetres/i);
    await expect(
      updateOnshapeFeature(http, { document: DOCUMENT, featureId: CREATED_HOLE_ID, diameterMm: -1 }),
    ).rejects.toThrow(/millimetres/i);
    await expect(
      updateOnshapeFeature(http, { document: DOCUMENT, featureId: CREATED_SHELL_ID, thicknessMm: "abc" }),
    ).rejects.toThrow(/millimetres/i);
    expect(http).not.toHaveBeenCalled();
  });

  it("encodes the real feature id on the update path", async () => {
    const featureId = "F Wx/1";
    const { http, calls } = captureHttp((path, init) => {
      if (!init?.method) return jsonResponse(extrudeExisting(featureId));
      return jsonResponse({ featureId });
    });
    const result = await updateOnshapeFeature(http, {
      document: DOCUMENT,
      featureId,
      depthMm: 9,
    });
    expect(result.featureId).toBe(featureId);
    expect(calls[0]?.path).toBe("/partstudios/d/d1/w/w1/e/e1/features/featureid/F%20Wx%2F1");
    expect(calls[1]?.path).toBe("/partstudios/d/d1/w/w1/e/e1/features/featureid/F%20Wx%2F1");
  });
});
