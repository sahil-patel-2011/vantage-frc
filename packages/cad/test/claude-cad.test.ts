import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { onshapeBasicAuthorization, onshapeApiKeysStatus, readOnshapeApiKeys } from "../src/onshape-api-keys";
import { extrudeFeature, onshapePlaneId, parseAddedFeatureId, rectangleSketchFeature } from "../src/onshape-features";
import { CLAUDE_CAD_INSTRUCTIONS, CLAUDE_CAD_TOOLS, callClaudeCadTool } from "../src/claude-cad";
import type { ClaudeCadSession } from "../src/claude-session";
import { signFusionRelayJob, verifyFusionRelayJob, FUSION_RELAY_PROTOCOL_VERSION } from "../src/fusion-relay";

describe("Onshape API keys for Claude Code", () => {
  it("reads ACCESS/SECRET or API_KEY/API_SECRET aliases", () => {
    expect(readOnshapeApiKeys({})).toBeNull();
    expect(onshapeApiKeysStatus({}).setupRequired).toBe(true);
    const creds = readOnshapeApiKeys({
      ONSHAPE_ACCESS_KEY: "ak",
      ONSHAPE_SECRET_KEY: "sk",
    } as NodeJS.ProcessEnv);
    expect(creds?.accessKey).toBe("ak");
    expect(
      readOnshapeApiKeys({
        ONSHAPE_API_KEY: "ak2",
        ONSHAPE_API_SECRET: "sk2",
      } as NodeJS.ProcessEnv)?.accessKey,
    ).toBe("ak2");
  });

  it("builds Basic auth without putting the secret in the prefix", () => {
    const header = onshapeBasicAuthorization("ak", "sk");
    expect(header.startsWith("Basic ")).toBe(true);
    expect(header).not.toContain("sk");
    expect(Buffer.from(header.slice(6), "base64").toString("utf8")).toBe("ak:sk");
  });
});

describe("Onshape feature payloads", () => {
  it("maps standard planes and builds a closed rectangle", () => {
    expect(onshapePlaneId("Top")).toBe("JDC");
    expect(onshapePlaneId("front")).toBe("JCC");
    const sketch = rectangleSketchFeature({ widthMm: 40, heightMm: 20, plane: "Top" });
    expect(sketch.feature.entities).toHaveLength(4);
    expect(sketch.feature.parameters[0]?.queries[0]?.deterministicIds).toEqual(["JDC"]);
    const extrude = extrudeFeature({ sketchFeatureId: "FidSketch", depthMm: 10 });
    expect(extrude.feature.featureType).toBe("extrude");
    expect(parseAddedFeatureId({ feature: { featureId: "FWx1" } })).toBe("FWx1");
  });

  it("rejects nonsense dimensions", () => {
    expect(() => rectangleSketchFeature({ widthMm: 0, heightMm: 10 })).toThrow(/millimetres/i);
  });
});

describe("Claude CAD tools", () => {
  it("exposes a small allowlisted tool set and setup copy", () => {
    const names = CLAUDE_CAD_TOOLS.map((tool) => tool.name);
    expect(names).toContain("onshape_sketch_rectangle");
    expect(names).toContain("fusion_extrude");
    expect(CLAUDE_CAD_INSTRUCTIONS).toMatch(/vantage-cad login/);
    expect(CLAUDE_CAD_INSTRUCTIONS).toMatch(/dev-portal.onshape.com\/keys/);
    expect(CLAUDE_CAD_INSTRUCTIONS).toMatch(/VantageCadRelay/);
  });

  it("cad_setup does not require credentials", async () => {
    const result = (await callClaudeCadTool("cad_setup")) as { instructions: string };
    expect(result.instructions).toMatch(/Claude Code/);
  });

  it("uses injected HTTP instead of env API keys", async () => {
    const paths: string[] = [];
    const http = async (path: string) => {
      paths.push(path);
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const result = (await callClaudeCadTool("onshape_list_documents", { limit: 4 }, { http, hosted: true })) as {
      documents: unknown[];
    };
    expect(result.documents).toEqual([]);
    expect(paths[0]).toMatch(/documents\?/);
  });

  it("uses the resolved browser-session transport before API keys", async () => {
    const paths: string[] = [];
    const http = async (path: string) => {
      paths.push(path);
      return Response.json({ items: [] });
    };
    const result = (await callClaudeCadTool(
      "onshape_list_documents",
      { limit: 2 },
      {
        resolveAuth: async () =>
          ({
            http,
            authPath: "session",
            countsAgainstAnnualCap: false,
          }) as never,
      },
    )) as { documents: unknown[] };

    expect(result.documents).toEqual([]);
    expect(paths[0]).toContain("/documents?");
  });

  it("creates and mates assembly instances without FeatureScript", async () => {
    let session: ClaudeCadSession = {
      documentId: "d1",
      workspaceId: "w1",
      elementId: "ps-1",
      documentName: "Robot",
    };
    let instanceCount = 0;
    let featureCount = 0;
    const paths: string[] = [];
    const http = async (path: string, init?: RequestInit) => {
      paths.push(path);
      if (path.endsWith("/instances")) {
        instanceCount += 1;
        return Response.json({ id: `instance-${instanceCount}` });
      }
      if (path.endsWith("/features") && init?.method === "POST") {
        featureCount += 1;
        return Response.json({ featureId: `assembly-feature-${featureCount}` });
      }
      if (path.includes("/assemblies/d/") && !path.includes("/e/")) {
        return Response.json({ id: "assembly-1" });
      }
      return Response.json({ rootAssembly: { instances: [] } });
    };
    const runtime = {
      http,
      loadSession: async () => session,
      saveSession: async (next: ClaudeCadSession) => {
        session = next;
      },
    };

    await callClaudeCadTool("onshape_create_assembly", { name: "Drivebase" }, runtime);
    const first = (await callClaudeCadTool(
      "onshape_add_assembly_instance",
      { partId: "part-left" },
      runtime,
    )) as { instanceId: string };
    const second = (await callClaudeCadTool(
      "onshape_add_assembly_instance",
      { partId: "part-right" },
      runtime,
    )) as { instanceId: string };
    const mate = (await callClaudeCadTool(
      "onshape_mate",
      {
        mateType: "FASTENED",
        firstInstanceId: first.instanceId,
        secondInstanceId: second.instanceId,
        firstFaceId: "face-left",
        secondFaceId: "face-right",
      },
      runtime,
    )) as { mateFeatureId: string; featureScriptUsed: boolean };

    expect(mate.mateFeatureId).toBe("assembly-feature-3");
    expect(mate.featureScriptUsed).toBe(false);
    expect(paths.some((path) => path.includes("featurescript"))).toBe(false);
  });

  it("skips Fusion loopback when hosted", async () => {
    const status = (await callClaudeCadTool("fusion_status", {}, { hosted: true })) as { setupRequired: boolean };
    expect(status.setupRequired).toBe(true);
  });

  it("refuses Onshape calls when no browser session, OAuth, or API keys exist", async () => {
    const saved = {
      ONSHAPE_ACCESS_KEY: process.env.ONSHAPE_ACCESS_KEY,
      ONSHAPE_SECRET_KEY: process.env.ONSHAPE_SECRET_KEY,
      ONSHAPE_API_KEY: process.env.ONSHAPE_API_KEY,
      ONSHAPE_API_SECRET: process.env.ONSHAPE_API_SECRET,
      VANTAGE_CAD_HOME: process.env.VANTAGE_CAD_HOME,
    };
    delete process.env.ONSHAPE_ACCESS_KEY;
    delete process.env.ONSHAPE_SECRET_KEY;
    delete process.env.ONSHAPE_API_KEY;
    delete process.env.ONSHAPE_API_SECRET;
    process.env.VANTAGE_CAD_HOME = join(tmpdir(), `vantage-cad-no-auth-${randomUUID()}`);
    try {
      await expect(callClaudeCadTool("onshape_list_documents")).rejects.toThrow(/not connected|pick one/i);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("signs Fusion envelopes the add-in will accept", () => {
    const envelope = signFusionRelayJob({
      version: FUSION_RELAY_PROTOCOL_VERSION,
      jobId: "j",
      stepId: "s",
      orgId: "o",
      userId: "u",
      deviceId: "d",
      machineName: "m",
      nonce: "n",
      leaseToken: "l",
      operation: {
        operation: "create_sketch",
        parameters: { widthMm: 40, heightMm: 20 },
        requiresApproval: true,
        reason: "test",
      },
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(verifyFusionRelayJob(envelope)).toBe(true);
  });
});
