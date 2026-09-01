import { describe, expect, it, vi } from "vitest";
import { createOnshapeApiTransport, type OnshapeHttp } from "../src/onshape";
import {
  dispatchOnshapeNativeFeature,
  isOnshapeNativeOperation,
  isOnshapeNativeUnimplemented,
  onshapeNativeUnimplementedError,
  type OnshapeNativeHttp,
} from "../src/onshape-native-dispatch";

const DOCUMENT = { documentId: "d1", workspaceId: "w1", elementId: "e1" };

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
  }) as unknown as OnshapeNativeHttp;
  return { http, calls };
}

function addFeatureHttp(featureId: string) {
  return captureHttp((path, init) => {
    if (path.endsWith("/features") && init?.method === "POST") {
      return jsonResponse({ featureId });
    }
    if (path.includes("/features/featureid/") && init?.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return jsonResponse({ message: `unexpected ${init?.method ?? "GET"} ${path}` }, 404);
  });
}

describe("native operation classification", () => {
  it("treats fillet/chamfer/shell/hole/pattern/mirror/delete/set_variable as native", () => {
    expect(
      [
        "create_fillet",
        "create_chamfer",
        "create_shell",
        "create_hole",
        "create_pattern",
        "create_mirror",
        "create_revolve",
        "create_boolean",
        "delete_feature",
        "set_variable",
      ].every(isOnshapeNativeOperation),
    ).toBe(true);
    expect(isOnshapeNativeUnimplemented("create_chamfer")).toBe(false);
    expect(isOnshapeNativeUnimplemented("create_shell")).toBe(false);
    expect(isOnshapeNativeUnimplemented("set_variable")).toBe(false);
  });

  it("keeps rollback as honest unimplemented", () => {
    expect(isOnshapeNativeUnimplemented("rollback_checkpoint")).toBe(true);
    const message = onshapeNativeUnimplementedError("rollback_checkpoint").message;
    expect(message).toMatch(/rollback is not a native Onshape action/i);
    expect(message).toMatch(/delete the last feature from the Vantage feature tree/i);
    expect(message).not.toMatch(/featurescript/i);
  });
});

describe("dispatchOnshapeNativeFeature", () => {
  it("posts a native fillet and reports featureScriptUsed=false", async () => {
    const { http, calls } = addFeatureHttp("fillet-real-1");
    const result = await dispatchOnshapeNativeFeature({
      http,
      document: DOCUMENT,
      operation: "create_fillet",
      parameters: { edgeIds: ["JHD", "JHE"], radius: "3 mm", name: "Corners" },
      idempotencyKey: "job:1:fillet",
    });
    expect(result).toEqual({ featureId: "fillet-real-1", featureScriptUsed: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/partstudios/d/d1/w/w1/e/e1/features");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.stringify(calls[0]?.body)).toContain('"featureType":"fillet"');
    expect(JSON.stringify(calls[0]?.body)).toContain("JHD");
    expect(calls.some((call) => call.path.includes("featurescript"))).toBe(false);
  });

  it("posts a native chamfer from composer-style entities + distance", async () => {
    const { http, calls } = addFeatureHttp("chamfer-real-1");
    const result = await dispatchOnshapeNativeFeature({
      http,
      document: DOCUMENT,
      operation: "create_chamfer",
      parameters: { entities: ["E1"], distance: "1 mm" },
      idempotencyKey: "job:1:chamfer",
    });
    expect(result).toEqual({ featureId: "chamfer-real-1", featureScriptUsed: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/partstudios/d/d1/w/w1/e/e1/features");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.stringify(calls[0]?.body)).toContain('"featureType":"chamfer"');
    expect(JSON.stringify(calls[0]?.body)).toContain("E1");
    expect(JSON.stringify(calls[0]?.body)).not.toMatch(/featurescript|opChamfer/i);
    expect(calls.some((call) => call.path.includes("featurescript"))).toBe(false);
  });

  it("posts a native shell from resolved face ids + thickness", async () => {
    const { http, calls } = addFeatureHttp("shell-real-1");
    const result = await dispatchOnshapeNativeFeature({
      http,
      document: DOCUMENT,
      operation: "create_shell",
      parameters: { faceIds: ["JFC"], thickness: "2 mm", name: "Hollow" },
      idempotencyKey: "job:1:shell",
    });
    expect(result).toEqual({ featureId: "shell-real-1", featureScriptUsed: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/partstudios/d/d1/w/w1/e/e1/features");
    expect(calls[0]?.method).toBe("POST");
    const posted = JSON.stringify(calls[0]?.body);
    expect(posted).toContain('"featureType":"shell"');
    expect(posted).toContain("JFC");
    expect(posted).toContain('"parameterId":"thickness"');
    expect(posted).toContain("2 mm");
    expect(posted).not.toMatch(/featurescript|opShell/i);
    expect(calls.some((call) => call.path.includes("featurescript"))).toBe(false);
  });

  it("refuses to guess shell face ids and never invents a feature id", async () => {
    const { http, calls } = addFeatureHttp("should-not-run");
    await expect(
      dispatchOnshapeNativeFeature({
        http,
        document: DOCUMENT,
        operation: "create_shell",
        parameters: { thickness: "2 mm" },
        idempotencyKey: "job:1:bad-shell",
      }),
    ).rejects.toThrow(/never guesses/i);
    expect(calls).toHaveLength(0);
  });

  it("posts a native hole using resolved location and scope ids", async () => {
    const { http, calls } = addFeatureHttp("hole-real-1");
    const result = await dispatchOnshapeNativeFeature({
      http,
      document: DOCUMENT,
      operation: "create_hole",
      parameters: { locationIds: ["V1"], scopeIds: ["B1"], diameterMm: 5, endStyle: "THROUGH" },
      idempotencyKey: "job:1:hole",
    });
    expect(result).toEqual({ featureId: "hole-real-1", featureScriptUsed: false });
    expect(JSON.stringify(calls[0]?.body)).toContain('"featureType":"hole"');
    expect(JSON.stringify(calls[0]?.body)).toContain("THROUGH");
  });

  it("refuses create_hole when only pointSketchFeatureId is given", async () => {
    const { http, calls } = addFeatureHttp("should-not-run");
    const error = await dispatchOnshapeNativeFeature({
      http,
      document: DOCUMENT,
      operation: "create_hole",
      parameters: { pointSketchFeatureId: "FPoints", diameterMm: 5 },
      idempotencyKey: "job:1:hole-nopicks",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toMatch(/hosted holes need location face ids and body ids from list-onshape-entities/i);
    expect(message).not.toMatch(/featurescript/i);
    expect(calls).toHaveLength(0);
  });

  it("posts a linear pattern along X without FeatureScript", async () => {
    const { http, calls } = addFeatureHttp("pattern-real-1");
    const result = await dispatchOnshapeNativeFeature({
      http,
      document: DOCUMENT,
      operation: "create_pattern",
      parameters: { featureIds: ["FHole"], count: 4, spacing: "25 mm", direction: "x" },
      idempotencyKey: "job:1:pattern",
    });
    expect(result.featureScriptUsed).toBe(false);
    expect(result.featureId).toBe("pattern-real-1");
    expect(JSON.stringify(calls[0]?.body)).toContain('"featureType":"linearPattern"');
    expect(calls.some((call) => call.path.includes("featurescript"))).toBe(false);
  });

  it("posts a circular pattern when axisIds are provided", async () => {
    const { http, calls } = addFeatureHttp("cpattern-real-1");
    const result = await dispatchOnshapeNativeFeature({
      http,
      document: DOCUMENT,
      operation: "create_pattern",
      parameters: { featureIds: ["FHole"], axisIds: ["JFACE"], instanceCount: 6, angleDeg: 360 },
      idempotencyKey: "job:1:cpattern",
    });
    expect(result.featureId).toBe("cpattern-real-1");
    expect(result.featureScriptUsed).toBe(false);
    expect(JSON.stringify(calls[0]?.body)).toContain('"featureType":"circularPattern"');
  });

  it("posts a native mirror across a standard plane", async () => {
    const { http, calls } = addFeatureHttp("mirror-real-1");
    const result = await dispatchOnshapeNativeFeature({
      http,
      document: DOCUMENT,
      operation: "create_mirror",
      parameters: { featureIds: ["FCut"], plane: "Right" },
      idempotencyKey: "job:1:mirror",
    });
    expect(result).toEqual({ featureId: "mirror-real-1", featureScriptUsed: false });
    expect(JSON.stringify(calls[0]?.body)).toContain('"featureType":"mirror"');
  });

  it("posts a native revolve around a listed axis", async () => {
    const { http, calls } = addFeatureHttp("revolve-real-1");
    const result = await dispatchOnshapeNativeFeature({
      http,
      document: DOCUMENT,
      operation: "create_revolve",
      parameters: { sketchFeatureId: "Fsketch", axisIds: ["JHD"], angleDeg: 360 },
      idempotencyKey: "job:1:revolve",
    });
    expect(result).toEqual({ featureId: "revolve-real-1", featureScriptUsed: false });
    expect(JSON.stringify(calls[0]?.body)).toContain('"featureType":"revolve"');
    expect(JSON.stringify(calls[0]?.body)).toContain("JHD");
    expect(calls.some((call) => call.path.includes("featurescript"))).toBe(false);
  });

  it("posts a native boolean subtract of listed bodies", async () => {
    const { http, calls } = addFeatureHttp("boolean-real-1");
    const result = await dispatchOnshapeNativeFeature({
      http,
      document: DOCUMENT,
      operation: "create_boolean",
      parameters: { operationType: "SUBTRACT", toolBodyIds: ["B2"], targetBodyIds: ["B1"] },
      idempotencyKey: "job:1:boolean",
    });
    expect(result).toEqual({ featureId: "boolean-real-1", featureScriptUsed: false });
    expect(JSON.stringify(calls[0]?.body)).toContain('"featureType":"boolean"');
    expect(JSON.stringify(calls[0]?.body)).toContain("BooleanOperationType");
  });

  it("deletes with DELETE and returns the real feature id", async () => {
    const { http, calls } = addFeatureHttp("unused");
    const result = await dispatchOnshapeNativeFeature({
      http,
      document: DOCUMENT,
      operation: "delete_feature",
      parameters: { featureId: "F-fillet" },
      idempotencyKey: "job:1:delete",
    });
    expect(result).toEqual({ featureId: "F-fillet", featureScriptUsed: false });
    expect(calls).toEqual([
      expect.objectContaining({
        method: "DELETE",
        path: "/partstudios/d/d1/w/w1/e/e1/features/featureid/F-fillet",
      }),
    ]);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("deletes using the first planned feature id when the composer stored a list", async () => {
    const { http, calls } = addFeatureHttp("unused");
    const result = await dispatchOnshapeNativeFeature({
      http,
      document: DOCUMENT,
      operation: "delete_feature",
      parameters: { featureId: ["F-fillet"] },
      idempotencyKey: "job:1:delete-list",
    });
    expect(result).toEqual({ featureId: "F-fillet", featureScriptUsed: false });
    expect(calls[0]?.path).toBe("/partstudios/d/d1/w/w1/e/e1/features/featureid/F-fillet");
  });

  it("refuses to guess edge ids and never invents a feature id", async () => {
    const { http, calls } = addFeatureHttp("should-not-run");
    await expect(
      dispatchOnshapeNativeFeature({
        http,
        document: DOCUMENT,
        operation: "create_fillet",
        parameters: { radiusMm: 3 },
        idempotencyKey: "job:1:bad-fillet",
      }),
    ).rejects.toThrow(/never guesses/i);
    expect(calls).toHaveLength(0);
  });

  it("refuses a circular pattern that only has axisFeatureId", async () => {
    const { http, calls } = addFeatureHttp("should-not-run");
    await expect(
      dispatchOnshapeNativeFeature({
        http,
        document: DOCUMENT,
        operation: "create_pattern",
        parameters: { featureIds: ["FHole"], axisFeatureId: "FBore", instanceCount: 4 },
        idempotencyKey: "job:1:bad-circular",
      }),
    ).rejects.toThrow(/will not invent an axis or generate FeatureScript/i);
    expect(calls).toHaveLength(0);
  });

  it("does not invent a feature id when Onshape rejects the add", async () => {
    const { http, calls } = captureHttp(() => jsonResponse({ message: "bad fillet" }, 400));
    await expect(
      dispatchOnshapeNativeFeature({
        http,
        document: DOCUMENT,
        operation: "create_fillet",
        parameters: { edgeIds: ["JHD"], radiusMm: 3 },
        idempotencyKey: "job:1:reject",
      }),
    ).rejects.toThrow(/bad fillet/);
    expect(calls).toHaveLength(1);
  });

  it("does not invent a feature id when Onshape omits one", async () => {
    const { http } = captureHttp(() => jsonResponse({ ok: true }));
    await expect(
      dispatchOnshapeNativeFeature({
        http,
        document: DOCUMENT,
        operation: "create_hole",
        parameters: { locationIds: ["V1"], scopeIds: ["B1"], diameterMm: 5 },
        idempotencyKey: "job:1:noid",
      }),
    ).rejects.toThrow(/did not return a feature id/i);
  });

  it("does not invent a feature id when delete is missing a target", async () => {
    const { http, calls } = addFeatureHttp("unused");
    await expect(
      dispatchOnshapeNativeFeature({
        http,
        document: DOCUMENT,
        operation: "delete_feature",
        parameters: {},
        idempotencyKey: "job:1:nodelete",
      }),
    ).rejects.toThrow(/requires featureId/i);
    expect(calls).toHaveLength(0);
  });

  it("does not invent a feature id when delete is rejected", async () => {
    const { http } = captureHttp(() => jsonResponse({ message: "not found" }, 404));
    await expect(
      dispatchOnshapeNativeFeature({
        http,
        document: DOCUMENT,
        operation: "delete_feature",
        parameters: { featureId: "F-missing" },
        idempotencyKey: "job:1:delete-miss",
      }),
    ).rejects.toThrow(/not found/);
  });

  it("dispatches set_variable through Variables REST, not FeatureScript", async () => {
    const tables = [{ variables: [{ name: "wallThickness", expression: "2 mm", type: "LENGTH" }] }];
    const { http, calls } = captureHttp((path, init) => {
      if (path.startsWith("/variables/") && (init?.method ?? "GET").toUpperCase() === "GET") {
        return jsonResponse(tables);
      }
      if (path.startsWith("/variables/") && init?.method === "POST") {
        return jsonResponse({});
      }
      return jsonResponse({ message: `unexpected ${init?.method ?? "GET"} ${path}` }, 404);
    });
    const result = await dispatchOnshapeNativeFeature({
      http,
      document: DOCUMENT,
      operation: "set_variable",
      parameters: { name: "wallThickness", value: "2 mm" },
      idempotencyKey: "job:1:var",
    });
    expect(result).toEqual({ featureId: "wallThickness", featureScriptUsed: false });
    expect(calls.every((call) => call.path === "/variables/d/d1/w/w1/e/e1/variables")).toBe(true);
    expect(calls.some((call) => call.method === "POST")).toBe(true);
    expect(calls.some((call) => call.path.includes("featurescript"))).toBe(false);
    expect(JSON.stringify(calls.map((call) => call.body))).not.toMatch(/featurescript|opAssignVariable/i);
  });

  it("refuses a blank or DEMO variable name without calling Onshape", async () => {
    const { http, calls } = addFeatureHttp("should-not-run");
    await expect(
      dispatchOnshapeNativeFeature({
        http,
        document: DOCUMENT,
        operation: "set_variable",
        parameters: { name: "", value: "2 mm" },
        idempotencyKey: "job:1:blank-var",
      }),
    ).rejects.toThrow(/requires a variable name/i);
    await expect(
      dispatchOnshapeNativeFeature({
        http,
        document: DOCUMENT,
        operation: "set_variable",
        parameters: { name: "DEMO", value: "2 mm" },
        idempotencyKey: "job:1:demo-var",
      }),
    ).rejects.toThrow(/DEMO/i);
    expect(calls).toHaveLength(0);
  });
});

describe("createOnshapeApiTransport native routing", () => {
  function transportWith(http: OnshapeHttp) {
    return createOnshapeApiTransport({ http, document: DOCUMENT });
  }

  it("routes fillet/chamfer/shell/hole/pattern/mirror/delete through native builders", async () => {
    const ids = ["fillet-1", "chamfer-1", "shell-1", "hole-1", "pattern-1", "mirror-1"] as const;
    let add = 0;
    const { http, calls } = captureHttp((path, init) => {
      if (path.endsWith("/features") && init?.method === "POST") {
        const id = ids[add] ?? `extra-${add}`;
        add += 1;
        return jsonResponse({ featureId: id });
      }
      if (path.includes("/features/featureid/") && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ message: "unexpected" }, 404);
    });
    const transport = transportWith(http as unknown as OnshapeHttp);

    const fillet = await transport.mutate({
      operation: "create_fillet",
      parameters: { edgeIds: ["JHD"], radiusMm: 2 },
      idempotencyKey: "job:t:fillet",
    });
    const chamfer = await transport.mutate({
      operation: "create_chamfer",
      parameters: { edgeIds: ["JHE"], widthMm: 1 },
      idempotencyKey: "job:t:chamfer",
    });
    const shell = await transport.mutate({
      operation: "create_shell",
      parameters: { faceIds: ["JFC"], thicknessMm: 2 },
      idempotencyKey: "job:t:shell",
    });
    const hole = await transport.mutate({
      operation: "create_hole",
      parameters: { locationIds: ["V1"], scopeIds: ["B1"], diameterMm: 5 },
      idempotencyKey: "job:t:hole",
    });
    const pattern = await transport.mutate({
      operation: "create_pattern",
      parameters: { featureIds: ["hole-1"], spacingMm: 20, instanceCount: 3, direction: "X" },
      idempotencyKey: "job:t:pattern",
    });
    const mirror = await transport.mutate({
      operation: "create_mirror",
      parameters: { featureIds: ["pattern-1"], plane: "Right" },
      idempotencyKey: "job:t:mirror",
    });
    const deleted = await transport.mutate({
      operation: "delete_feature",
      parameters: { featureId: "mirror-1" },
      idempotencyKey: "job:t:delete",
    });

    expect(fillet).toMatchObject({ featureId: "fillet-1", featureScriptUsed: false });
    expect(chamfer).toMatchObject({ featureId: "chamfer-1", featureScriptUsed: false });
    expect(shell).toMatchObject({ featureId: "shell-1", featureScriptUsed: false });
    expect(hole).toMatchObject({ featureId: "hole-1", featureScriptUsed: false });
    expect(pattern).toMatchObject({ featureId: "pattern-1", featureScriptUsed: false });
    expect(mirror).toMatchObject({ featureId: "mirror-1", featureScriptUsed: false });
    expect(deleted).toMatchObject({ featureId: "mirror-1", featureScriptUsed: false });
    expect(calls.some((call) => call.path.includes("featurescript"))).toBe(false);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(6);
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
    expect(JSON.stringify(calls.map((call) => call.body))).not.toMatch(/featurescript|opChamfer|opShell/i);
  });

  it("routes set_variable through Variables REST", async () => {
    const tables = [{ variables: [{ name: "wallThickness", expression: "2 mm", type: "LENGTH" }] }];
    const { http, calls } = captureHttp((path, init) => {
      if (path.startsWith("/variables/") && (init?.method ?? "GET").toUpperCase() === "GET") {
        return jsonResponse(tables);
      }
      if (path.startsWith("/variables/") && init?.method === "POST") {
        return jsonResponse({});
      }
      return jsonResponse({ message: `unexpected ${init?.method ?? "GET"} ${path}` }, 404);
    });
    const transport = transportWith(http as unknown as OnshapeHttp);
    const result = await transport.mutate({
      operation: "set_variable",
      parameters: { name: "wallThickness", value: "2 mm" },
      idempotencyKey: "job:t:var",
    });
    expect(result).toMatchObject({ featureId: "wallThickness", featureScriptUsed: false });
    expect(calls.some((call) => call.path === "/variables/d/d1/w/w1/e/e1/variables" && call.method === "POST")).toBe(true);
    expect(calls.some((call) => call.path.includes("featurescript"))).toBe(false);
  });

  it("keeps unimplemented ops as honest errors and does not call Onshape", async () => {
    const http = vi.fn(async () => jsonResponse({ message: "should not run" }, 500)) as unknown as OnshapeHttp;
    const transport = transportWith(http);
    const error = await transport
      .mutate({
        operation: "rollback_checkpoint",
        parameters: { checkpointRef: "cp-1" },
        idempotencyKey: "job:t:rollback",
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toMatch(/rollback is not a native Onshape action/i);
    expect(message).toMatch(/delete the last feature from the Vantage feature tree/i);
    expect(message).not.toMatch(/featurescript/i);
    expect(http).not.toHaveBeenCalled();
  });

  it("does not fall back to FeatureScript when shell is missing face ids", async () => {
    const http = vi.fn(async () => jsonResponse({ message: "should not run" }, 500)) as unknown as OnshapeHttp;
    const transport = transportWith(http);
    await expect(
      transport.mutate({ operation: "create_shell", parameters: { thickness: "2 mm" }, idempotencyKey: "job:t:shell" }),
    ).rejects.toThrow(/never guesses/i);
    expect(http).not.toHaveBeenCalled();
  });
});
