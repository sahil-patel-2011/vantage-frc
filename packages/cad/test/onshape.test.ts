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

  it("soft-fails placeholder sketch when FeatureScript is rejected", async () => {
    const http: OnshapeHttp = vi.fn(async () =>
      Response.json({ message: "bad script" }, { status: 400 }),
    ) as unknown as OnshapeHttp;
    const transport = createOnshapeApiTransport({
      http,
      document: { documentId: "d1", workspaceId: "w1", elementId: "e1" },
    });
    const result = await transport.mutate({
      operation: "create_sketch",
      parameters: { widthMm: 40 },
      idempotencyKey: "idem-sketch",
    });
    expect(result.featureId).toMatch(/^intent-create_sketch-/);
  });
});
