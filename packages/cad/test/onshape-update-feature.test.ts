import { describe, expect, it, vi } from "vitest";
import { extrudeFeature, rectangleSketchFeature } from "../src/onshape-features";
import {
  applyNativeFeatureDimensions,
  requireCreatedOnshapeFeatureId,
  updateOnshapeFeature,
  type OnshapeUpdateFeatureHttp,
} from "../src/onshape-update-feature";

const DOCUMENT = { documentId: "d1", workspaceId: "w1", elementId: "e1" };
const CREATED_EXTRUDE_ID = "FWxExtrude1";
const CREATED_SKETCH_ID = "FWxSketch1";

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

  it("refuses a re-run that has no depth or width", async () => {
    const http = vi.fn(async () => jsonResponse(extrudeExisting())) as unknown as OnshapeUpdateFeatureHttp;
    await expect(updateOnshapeFeature(http, { document: DOCUMENT, featureId: CREATED_EXTRUDE_ID })).rejects.toThrow(
      /depthMm and\/or widthMm/i,
    );
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
