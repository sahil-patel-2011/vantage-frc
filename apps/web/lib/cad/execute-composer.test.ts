import { afterEach, describe, expect, it, vi } from "vitest";
import { executeComposerOp, existingFeatureId, parseSerializedComposerOp } from "./execute-composer";

const ORG = "00000000-0000-0000-0000-000000000001";
const JOB = "00000000-0000-0000-0000-0000000000aa";
const STEP = "00000000-0000-0000-0000-0000000000bb";
const FEATURE = "FWx/real-extrude-1";
const DOCUMENT = { documentId: "did", workspaceId: "wid", elementId: "eid" };

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

function pipelineFetch(options?: { confirmed?: boolean; execute?: Record<string, unknown> }) {
  return installFetch((url, body) => {
    if (!body) {
      return jsonResponse({
        jobs: [
          {
            id: JOB,
            title: "CAD agent",
            platform: "onshape",
            brief: { kind: "cad_agent", messages: [] },
            briefConfirmedAt: options?.confirmed === false ? null : "2026-08-31T00:00:00.000Z",
          },
        ],
      });
    }
    switch (body.action) {
      case "confirm":
      case "set-document":
      case "approve":
        return jsonResponse({ success: true });
      case "append-step":
        return jsonResponse({ id: STEP, sequence: 1 });
      case "execute-onshape":
        return jsonResponse(options?.execute ?? { externalFeatureId: FEATURE, output: { operation: body.operation } });
      case "update-onshape-feature":
        return jsonResponse({ featureId: body.featureId, featureScriptUsed: false });
      default:
        return jsonResponse({ error: `unexpected action ${String(body.action)}` }, 400);
    }
  });
}

describe("parseSerializedComposerOp", () => {
  it("accepts a native serialized composer op", () => {
    expect(
      parseSerializedComposerOp({
        operation: "create_sketch",
        parameters: { widthMm: 80, heightMm: 40, plane: "Top" },
        reason: "Base profile",
      }),
    ).toEqual({
      operation: "create_sketch",
      parameters: { widthMm: 80, heightMm: 40, plane: "Top" },
      reason: "Base profile",
    });
  });

  it("rejects FeatureScript and unknown ops before any fetch", () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    expect(() => parseSerializedComposerOp({ operation: "feature_script", parameters: { source: "opExtrude" } })).toThrow(
      /FeatureScript/i,
    );
    expect(() =>
      parseSerializedComposerOp({ operation: "create_sketch", parameters: { source: "opExtrude(id)" } }),
    ).toThrow(/FeatureScript/i);
    expect(() => parseSerializedComposerOp({ operation: "delete_everything" })).toThrow(/native/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("existingFeatureId", () => {
  it("returns a real id and refuses DEMO or empty values", () => {
    expect(existingFeatureId(undefined, "", { featureId: FEATURE })).toBe(FEATURE);
    expect(existingFeatureId(null, {}, { sketchFeatureId: "F1" })).toBeUndefined();
    expect(() => existingFeatureId("DEMO-plate")).toThrow(/DEMO feature id/i);
    expect(() => existingFeatureId({ featureId: "demo-extrude" })).toThrow(/DEMO feature id/i);
  });
});

describe("executeComposerOp", () => {
  const sketch = {
    operation: "create_sketch",
    parameters: { widthMm: 80, heightMm: 40, plane: "Top" },
    reason: "Base profile",
  };

  it("posts append-step, approve, then execute-onshape for a new native op", async () => {
    const calls = pipelineFetch({ confirmed: true });
    const result = await executeComposerOp({ orgId: ORG, payload: sketch, documentRef: DOCUMENT });

    expect(result.action).toBe("execute-onshape");
    expect(result.jobId).toBe(JOB);
    expect(result.stepId).toBe(STEP);
    expect(result.featureId).toBe(FEATURE);

    const actions = calls.filter((call) => call.body).map((call) => call.body!.action);
    expect(actions).toEqual(["set-document", "append-step", "approve", "execute-onshape"]);

    const execute = calls.find((call) => call.body?.action === "execute-onshape")!.body!;
    expect(execute).toEqual({ action: "execute-onshape", orgId: ORG, jobId: JOB, stepId: STEP });
    expect(execute).not.toHaveProperty("featureId");
    expect(JSON.stringify(calls)).not.toMatch(/feature_script/i);
    expect(JSON.stringify(calls)).not.toMatch(/DEMO/i);

    const appended = calls.find((call) => call.body?.action === "append-step")!.body!;
    expect(appended.operation).toBe("create_sketch");
    expect(appended.parameters).toEqual(sketch.parameters);
    expect(appended.reason).toBe("Base profile");
  });

  it("confirms the existing job brief when it is not yet confirmed", async () => {
    const calls = pipelineFetch({ confirmed: false });
    await executeComposerOp({ orgId: ORG, payload: sketch, documentRef: DOCUMENT });
    const confirm = calls.find((call) => call.body?.action === "confirm")!.body!;
    expect(confirm.jobId).toBe(JOB);
    expect(confirm.brief).toEqual({ kind: "cad_agent", messages: [] });
    expect(calls.map((call) => call.body?.action)).toEqual([
      undefined,
      "confirm",
      "set-document",
      "append-step",
      "approve",
      "execute-onshape",
    ]);
  });

  it("posts update-onshape-feature when a real featureId exists", async () => {
    const calls = pipelineFetch();
    const result = await executeComposerOp({
      orgId: ORG,
      payload: { operation: "create_extrude", parameters: { depthMm: 6, featureId: FEATURE }, reason: "Thicken" },
      documentRef: DOCUMENT,
    });
    expect(result.action).toBe("update-onshape-feature");
    expect(result.featureId).toBe(FEATURE);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({
      action: "update-onshape-feature",
      orgId: ORG,
      featureId: FEATURE,
      documentRef: DOCUMENT,
      depthMm: 6,
    });
    expect(calls[0]!.body).not.toHaveProperty("source");
    expect(JSON.stringify(calls)).not.toMatch(/feature_script/i);
  });

  it("forwards fillet/hole/shell millimetres on update-onshape-feature", async () => {
    const calls = pipelineFetch();
    await executeComposerOp({
      orgId: ORG,
      payload: {
        operation: "create_fillet",
        parameters: { featureId: FEATURE, radiusMm: 2, diameterMm: 5, thicknessMm: 1.5 },
      },
      documentRef: DOCUMENT,
    });
    expect(calls[0]!.body).toMatchObject({
      action: "update-onshape-feature",
      featureId: FEATURE,
      radiusMm: 2,
      diameterMm: 5,
      thicknessMm: 1.5,
    });
  });

  it("does not invent a featureId when none was returned", async () => {
    expect(existingFeatureId(undefined, null, "")).toBeUndefined();
    const calls = pipelineFetch({ execute: { output: { operation: "create_sketch" } } });
    const result = await executeComposerOp({ orgId: ORG, payload: sketch, documentRef: DOCUMENT, jobId: JOB });
    expect(result.featureId).toBeUndefined();
    expect(calls.find((call) => call.body?.action === "execute-onshape")!.body).not.toHaveProperty("featureId");
  });

  it("surfaces a missing-OAuth error from the API without inventing geometry", async () => {
    installFetch((_url, body) => {
      if (!body) {
        return jsonResponse({
          jobs: [{ id: JOB, title: "CAD agent", platform: "onshape", briefConfirmedAt: "2026-08-31T00:00:00.000Z" }],
        });
      }
      if (body.action === "set-document" || body.action === "execute-onshape" || body.action === "update-onshape-feature") {
        return jsonResponse(
          {
            error:
              "Setup required — connect Onshape OAuth in CAD Connections before hosted CAD can edit a Part Studio.",
            code: "setup_required",
          },
          503,
        );
      }
      if (body.action === "append-step") return jsonResponse({ id: STEP });
      return jsonResponse({ success: true });
    });
    await expect(executeComposerOp({ orgId: ORG, payload: sketch, documentRef: DOCUMENT })).rejects.toThrow(/OAuth/i);
    await expect(
      executeComposerOp({
        orgId: ORG,
        payload: { operation: "create_extrude", parameters: { depthMm: 6, featureId: FEATURE } },
        documentRef: DOCUMENT,
      }),
    ).rejects.toThrow(/OAuth/i);
  });

  it("fails honestly when orgId, document, or job is missing", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await expect(executeComposerOp({ orgId: "", payload: sketch, documentRef: DOCUMENT })).rejects.toThrow(/orgId/i);
    expect(fetchSpy).not.toHaveBeenCalled();

    await expect(
      executeComposerOp({
        orgId: ORG,
        payload: { operation: "create_extrude", parameters: { featureId: FEATURE, depthMm: 6 } },
      }),
    ).rejects.toThrow(/document\/workspace\/element/i);
    expect(fetchSpy).not.toHaveBeenCalled();

    installFetch(() => jsonResponse({ jobs: [] }));
    await expect(executeComposerOp({ orgId: ORG, payload: sketch })).rejects.toThrow(/Bind an Onshape document/i);
  });

  it("rejects FeatureScript payloads without calling /api/cad", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await expect(
      executeComposerOp({ orgId: ORG, payload: { operation: "feature_script", parameters: { source: "opExtrude" } } }),
    ).rejects.toThrow(/FeatureScript/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
