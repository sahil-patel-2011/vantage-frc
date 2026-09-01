import { describe, expect, it, vi } from "vitest";
import {
  buildDefaultCadPlan,
  buildOnshapeAuthorizeUrl,
  cadOsSupportMatrix,
  createOnshapeApiTransport,
  createOnshapeHttp,
  createOnshapeOAuthState,
  explainFeatureTreeForStudents,
  exportOnshapePartStudio,
  getOnshapeOAuthConfig,
  isOnshapeOAuthConfigured,
  onshapeSetupStatus,
  verifyOnshapeOAuthState,
  type OnshapeHttp,
} from "../src/index";
import { circleSketchFeature, polylineSketchFeature, rectangleSketchFeature } from "../src/onshape-features";

describe("Onshape hosted setup", () => {
  it("reports setup-required when OAuth env is missing", () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(isOnshapeOAuthConfigured(env)).toBe(false);
    expect(onshapeSetupStatus(env).setupRequired).toBe(true);
    expect(onshapeSetupStatus(env).message).toMatch(/Setup required/i);
    expect(getOnshapeOAuthConfig(env)).toBeNull();
  });

  it("builds authorize URL when configured", () => {
    const env = {
      ONSHAPE_OAUTH_CLIENT_ID: "cid",
      ONSHAPE_OAUTH_CLIENT_SECRET: "csecret",
      BETTER_AUTH_URL: "https://vantage.example",
      BETTER_AUTH_SECRET: "state-secret",
    } as NodeJS.ProcessEnv;
    expect(isOnshapeOAuthConfigured(env)).toBe(true);
    const config = getOnshapeOAuthConfig(env)!;
    const state = createOnshapeOAuthState({ orgId: "org-1", userId: "user-1" }, env);
    const claims = verifyOnshapeOAuthState(state, env);
    expect(claims.orgId).toBe("org-1");
    const url = buildOnshapeAuthorizeUrl(config, state);
    expect(url).toContain("oauth.onshape.com/oauth/authorize");
    expect(url).toContain("client_id=cid");
    expect(url).toContain(encodeURIComponent(config.redirectUri));
  });

  it("documents honest Linux Fusion limits", () => {
    const linux = cadOsSupportMatrix().find((row) => row.os === "linux");
    expect(linux?.fusion360Autodesk).toBe("unsupported");
    expect(linux?.onshapeHosted).toBe("supported");
  });
});

describe("Onshape feature-tree explain + export plan", () => {
  it("explains feature trees in student-friendly language", () => {
    const explain = explainFeatureTreeForStudents([
      { id: "1", name: "Sketch 1", featureType: "newSketch", suppressed: false },
      { id: "2", name: "Extrude 1", featureType: "extrude", suppressed: false },
      { id: "3", name: "Old cut", featureType: "extrude", suppressed: true },
    ]);
    expect(explain.overview).toMatch(/2 active/);
    expect(explain.steps).toHaveLength(2);
    expect(explain.steps[0]?.plainEnglish).toMatch(/2D drawing/i);
    expect(explain.disclaimer).toMatch(/Educational/i);
  });

  it("includes STEP export in default Onshape-style plans when requested", () => {
    const plan = buildDefaultCadPlan(
      {
        summary: "intake plate",
        assumptions: [{ name: "Envelope dimensions", value: "100mm", needsConfirmation: false }],
      },
      { autoRunVerify: true, includeExport: "step" },
    );
    expect(plan.map((s) => s.operation)).toEqual([
      "create_sketch",
      "create_extrude",
      "verify_topology",
      "export_step",
    ]);
    expect(plan.at(-1)?.requiresApproval).toBe(true);
  });
});

describe("Onshape export + transport (mocked HTTP)", () => {
  it("exports STL with checksum provenance", async () => {
    const stl = "solid test\nendsolid test\n";
    const http: OnshapeHttp = vi.fn(async (path: string) => {
      if (path.includes("/stl")) {
        return new Response(stl, { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }) as unknown as OnshapeHttp;

    const result = await exportOnshapePartStudio(
      http,
      { documentId: "d1", workspaceId: "w1", elementId: "e1" },
      "STL",
    );
    expect(result.provenance.format).toBe("STL");
    expect(result.provenance.requestState).toBe("DONE");
    expect(result.provenance.contentSha256).toHaveLength(64);
    expect(result.provenance.source).toBe("onshape-api");
    expect(result.previewText).toContain("solid test");
  });

  it("runs export_step through live transport and describe", async () => {
    const http: OnshapeHttp = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/translations") && init?.method === "POST") {
        return Response.json({ id: "tr-1", requestState: "DONE" });
      }
      if (path.includes("/translations/tr-1")) {
        return Response.json({
          requestState: "DONE",
          resultExternalDataIds: ["ext-1"],
        });
      }
      if (path.endsWith("/features")) {
        return Response.json({
          features: [{ featureId: "F1", message: { name: "Sketch 1", featureType: "newSketch" } }],
        });
      }
      if (path.endsWith("/massproperties")) {
        return Response.json({ bodies: [] });
      }
      return new Response("{}", { status: 404 });
    }) as unknown as OnshapeHttp;

    const transport = createOnshapeApiTransport({
      http,
      document: { documentId: "d1", workspaceId: "w1", elementId: "e1", label: "Test" },
    });
    const mutation = await transport.mutate({
      operation: "export_step",
      parameters: {},
      idempotencyKey: "job:1:export",
    });
    expect(mutation.exportArtifact?.provenance.format).toBe("STEP");
    expect(mutation.exportArtifact?.type).toBe("cad_export_step");
    const described = await transport.describe();
    expect(described.summary.validation).toBe("onshape-live");
    expect(described.summary.featureCount).toBe(1);
    expect((described.summary.studentExplain as { steps: unknown[] }).steps.length).toBe(1);
  });

  it("createOnshapeHttp targets v6 API base", () => {
    const http = createOnshapeHttp("token-xyz", "https://cad.onshape.com/api/v6");
    expect(typeof http).toBe("function");
  });

  it("lists documents and elements through a stub OnshapeHttp", async () => {
    const http: OnshapeHttp = vi.fn(async (path: string) => {
      if (path.includes("/documents?") && !path.includes("/elements")) {
        return Response.json({
          items: [{ id: "doc-1", name: "Disposable Fixture", defaultWorkspace: { id: "ws-1" } }],
        });
      }
      if (path.includes("/elements")) {
        return Response.json([{ id: "el-1", name: "Part Studio 1", elementType: "PARTSTUDIO" }]);
      }
      return Response.json({ error: "unexpected" }, { status: 404 });
    }) as unknown as OnshapeHttp;

    const { listOnshapeDocuments, listOnshapeElements } = await import("../src/onshape");
    const docs = await listOnshapeDocuments(http);
    expect(docs).toEqual([{ id: "doc-1", name: "Disposable Fixture", defaultWorkspaceId: "ws-1" }]);
    const elements = await listOnshapeElements(http, "doc-1", "ws-1");
    expect(elements[0]).toMatchObject({ id: "el-1", elementType: "PARTSTUDIO" });
  });

  it("does not report success when Onshape rejects a geometry mutation", async () => {
    const http: OnshapeHttp = vi.fn(async () =>
      Response.json({ message: "bad feature" }, { status: 400 }),
    ) as unknown as OnshapeHttp;
    const transport = createOnshapeApiTransport({
      http,
      document: { documentId: "d1", workspaceId: "w1", elementId: "e1" },
    });
    await expect(
      transport.mutate({
        operation: "create_sketch",
        parameters: { widthMm: 40, heightMm: 20 },
        idempotencyKey: "job-1:1:sketch",
      }),
    ).rejects.toThrow(/bad feature/);
  });

  it("creates real sketch and extrude features with returned Onshape ids", async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const http: OnshapeHttp = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/features") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        requests.push({ path, body });
        const feature = body.feature as { featureType?: string };
        return Response.json({
          featureId: feature.featureType === "newSketch" ? "sketch-real-1" : "extrude-real-1",
        });
      }
      return Response.json({ message: "unexpected request" }, { status: 404 });
    }) as unknown as OnshapeHttp;
    const transport = createOnshapeApiTransport({
      http,
      document: { documentId: "d1", workspaceId: "w1", elementId: "e1" },
    });

    const sketch = await transport.mutate({
      operation: "create_sketch",
      parameters: { widthMm: 80, heightMm: 50, plane: "Top", name: "RectSketch" },
      idempotencyKey: "job-1:1:sketch",
    });
    const extrude = await transport.mutate({
      operation: "create_extrude",
      parameters: { sketchFeatureId: sketch.featureId, depthMm: 6 },
      idempotencyKey: "job-1:2:extrude",
    });

    expect(sketch.featureId).toBe("sketch-real-1");
    expect(sketch.featureScriptUsed).toBe(false);
    expect(extrude.featureId).toBe("extrude-real-1");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.path).toContain("/features");
    expect(requests[0]?.path.toLowerCase()).not.toMatch(/featurescript/);
    expect(requests[0]?.body).toEqual(
      rectangleSketchFeature({ widthMm: 80, heightMm: 50, plane: "Top", name: "RectSketch" }),
    );
    expect(JSON.stringify(requests[0]?.body)).toContain("newSketch");
    expect(JSON.stringify(requests[0]?.body)).toContain("rect.bottom");
    expect(JSON.stringify(requests[1]?.body)).toContain("sketch-real-1");
  });

  it("creates a circle sketch via circleSketchFeature without FeatureScript", async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const http: OnshapeHttp = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/features") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        requests.push({ path, body });
        return Response.json({ featureId: "sketch-circle-1" });
      }
      return Response.json({ message: "unexpected request" }, { status: 404 });
    }) as unknown as OnshapeHttp;
    const transport = createOnshapeApiTransport({
      http,
      document: { documentId: "d1", workspaceId: "w1", elementId: "e1" },
    });

    const byKind = await transport.mutate({
      operation: "create_sketch",
      parameters: { sketchKind: "circle", radiusMm: 12, plane: "Front", name: "CircleKind" },
      idempotencyKey: "job-circle:1:sketch",
    });
    const byCase = await transport.mutate({
      operation: "create_sketch",
      parameters: { sketchKind: "CIRCLE", radius: 8, plane: "Top", name: "CircleRadius" },
      idempotencyKey: "job-circle:2:sketch",
    });

    expect(byKind).toEqual({ featureId: "sketch-circle-1", featureScriptUsed: false });
    expect(byCase).toEqual({ featureId: "sketch-circle-1", featureScriptUsed: false });
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.path.endsWith("/features"))).toBe(true);
    expect(requests.some((request) => request.path.toLowerCase().includes("featurescript"))).toBe(false);
    expect(JSON.stringify(requests).toLowerCase()).not.toContain("featurescript");
    expect(requests[0]?.body).toEqual(
      circleSketchFeature({
        name: "CircleKind",
        plane: "Front",
        circles: [{ diameterMm: 24 }],
      }),
    );
    expect(requests[1]?.body).toEqual(
      circleSketchFeature({
        name: "CircleRadius",
        plane: "Top",
        circles: [{ diameterMm: 16 }],
      }),
    );
    expect(JSON.stringify(requests[0]?.body)).toContain("BTCurveGeometryCircle-115");
  });

  it("ignores leftover radiusMm when sketchKind is rectangle or omitted", async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const http: OnshapeHttp = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/features") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        requests.push({ path, body });
        return Response.json({ featureId: "sketch-rect-1" });
      }
      return Response.json({ message: "unexpected request" }, { status: 404 });
    }) as unknown as OnshapeHttp;
    const transport = createOnshapeApiTransport({
      http,
      document: { documentId: "d1", workspaceId: "w1", elementId: "e1" },
    });

    const byKind = await transport.mutate({
      operation: "create_sketch",
      parameters: {
        sketchKind: "rectangle",
        widthMm: 80,
        heightMm: 50,
        radiusMm: 12,
        plane: "Top",
        name: "RectDespiteRadius",
      },
      idempotencyKey: "job-rect:1:sketch",
    });
    const omitted = await transport.mutate({
      operation: "create_sketch",
      parameters: {
        widthMm: 40,
        heightMm: 20,
        radiusMm: 99,
        plane: "Front",
        name: "RectOmittedKind",
      },
      idempotencyKey: "job-rect:2:sketch",
    });

    expect(byKind).toEqual({ featureId: "sketch-rect-1", featureScriptUsed: false });
    expect(omitted).toEqual({ featureId: "sketch-rect-1", featureScriptUsed: false });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.body).toEqual(
      rectangleSketchFeature({ widthMm: 80, heightMm: 50, plane: "Top", name: "RectDespiteRadius" }),
    );
    expect(requests[1]?.body).toEqual(
      rectangleSketchFeature({ widthMm: 40, heightMm: 20, plane: "Front", name: "RectOmittedKind" }),
    );
    expect(JSON.stringify(requests)).not.toContain("BTCurveGeometryCircle-115");
  });

  it("creates a closed polyline sketch from explicit millimetre points", async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const http: OnshapeHttp = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/features") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        requests.push({ path, body });
        return Response.json({ featureId: "sketch-poly-1" });
      }
      return Response.json({ message: "unexpected request" }, { status: 404 });
    }) as unknown as OnshapeHttp;
    const transport = createOnshapeApiTransport({
      http,
      document: { documentId: "d1", workspaceId: "w1", elementId: "e1" },
    });

    const created = await transport.mutate({
      operation: "create_sketch",
      parameters: {
        sketchKind: "polyline",
        points: "0,0; 80,0; 80,40; 0,40",
        plane: "Top",
        name: "Gusset",
      },
      idempotencyKey: "job-poly:1:sketch",
    });

    expect(created).toEqual({ featureId: "sketch-poly-1", featureScriptUsed: false });
    expect(requests[0]?.body).toEqual(
      polylineSketchFeature({
        name: "Gusset",
        plane: "Top",
        closed: true,
        points: [
          { xMm: 0, yMm: 0 },
          { xMm: 80, yMm: 0 },
          { xMm: 80, yMm: 40 },
          { xMm: 0, yMm: 40 },
        ],
      }),
    );
    expect(JSON.stringify(requests[0]?.body).toLowerCase()).not.toContain("featurescript");
  });

  it("refuses a polyline sketch without measured points", async () => {
    const http: OnshapeHttp = vi.fn(async () =>
      Response.json({ message: "should not post" }, { status: 500 }),
    ) as unknown as OnshapeHttp;
    const transport = createOnshapeApiTransport({
      http,
      document: { documentId: "d1", workspaceId: "w1", elementId: "e1" },
    });
    await expect(
      transport.mutate({
        operation: "create_sketch",
        parameters: { sketchKind: "polyline" },
        idempotencyKey: "job-poly:2:sketch",
      }),
    ).rejects.toThrow(/at least two millimetre points/i);
    expect(http).not.toHaveBeenCalled();
  });

  it("refuses create_sketch without a positive millimetre dimension", async () => {
    const http: OnshapeHttp = vi.fn(async () =>
      Response.json({ message: "should not post" }, { status: 500 }),
    ) as unknown as OnshapeHttp;
    const transport = createOnshapeApiTransport({
      http,
      document: { documentId: "d1", workspaceId: "w1", elementId: "e1" },
    });
    await expect(
      transport.mutate({
        operation: "create_sketch",
        parameters: {},
        idempotencyKey: "job-missing:1:sketch",
      }),
    ).rejects.toThrow(/must be a positive number in millimetres; no geometry was created/);
    await expect(
      transport.mutate({
        operation: "create_sketch",
        parameters: { sketchKind: "circle" },
        idempotencyKey: "job-missing:2:sketch",
      }),
    ).rejects.toThrow(/Sketch radius must be a positive number in millimetres; no geometry was created/);
    await expect(
      transport.mutate({
        operation: "create_sketch",
        parameters: { radiusMm: 12 },
        idempotencyKey: "job-missing:3:sketch",
      }),
    ).rejects.toThrow(/Sketch width must be a positive number in millimetres; no geometry was created/);
    expect(http).not.toHaveBeenCalled();
  });

  it("refuses rollback as a native-only Onshape action", async () => {
    const transport = createOnshapeApiTransport({
      http: vi.fn(async () => new Response("{}", { status: 404 })) as unknown as OnshapeHttp,
      document: { documentId: "d1", workspaceId: "w1", elementId: "e1" },
    });
    let message = "";
    try {
      await transport.rollback("onshape-cp-abc123");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/Rollback of onshape-cp-abc123 is not a native Onshape action in Vantage/);
    expect(message.toLowerCase()).not.toContain("featurescript");
  });

  it("creates and verifies native assemblies and mates without FeatureScript", async () => {
    const paths: string[] = [];
    let assemblyFeature = 0;
    const http: OnshapeHttp = vi.fn(async (path: string, init?: RequestInit) => {
      paths.push(`${init?.method ?? "GET"} ${path}`);
      if (path === "/assemblies/d/d1/w/w1" && init?.method === "POST") {
        return Response.json({ id: "assembly-1" });
      }
      if (path.endsWith("/instances") && init?.method === "POST") {
        return Response.json({ id: "instance-1" });
      }
      if (path.endsWith("/features") && init?.method === "POST") {
        assemblyFeature += 1;
        return Response.json({ featureId: `assembly-feature-${assemblyFeature}` });
      }
      if (path.includes("/assemblies/") && !init?.method) {
        return Response.json({ rootAssembly: { instances: [{ id: "instance-1" }] } });
      }
      return Response.json({ message: "unexpected request" }, { status: 404 });
    }) as unknown as OnshapeHttp;
    const transport = createOnshapeApiTransport({
      http,
      document: { documentId: "d1", workspaceId: "w1", elementId: "ps-1" },
    });

    const assembly = await transport.mutate({
      operation: "create_assembly",
      parameters: { name: "Drivebase" },
      idempotencyKey: "job-2:1:assembly",
    });
    const instance = await transport.mutate({
      operation: "add_assembly_instance",
      parameters: {
        assemblyElementId: assembly.featureId,
        sourceElementId: "ps-1",
        partId: "part-1",
      },
      idempotencyKey: "job-2:2:instance",
    });
    const mate = await transport.mutate({
      operation: "create_mate",
      parameters: {
        assemblyElementId: assembly.featureId,
        mateType: "FASTENED",
        firstInstanceId: instance.featureId,
        secondInstanceId: "instance-2",
        firstFaceId: "face-1",
        secondFaceId: "face-2",
      },
      idempotencyKey: "job-2:3:mate",
    });
    const described = await transport.describe();

    expect(assembly.featureId).toBe("assembly-1");
    expect(instance.featureId).toBe("instance-1");
    expect(mate.featureId).toBe("assembly-feature-3");
    expect(described.summary.validation).toBe("onshape-live-assembly");
    expect(paths.some((path) => path.includes("featurescript"))).toBe(false);
  });
});
