import { describe, expect, it } from "vitest";
import { onshapeBasicAuthorization, onshapeApiKeysStatus, readOnshapeApiKeys } from "../src/onshape-api-keys";
import { extrudeFeature, onshapePlaneId, parseAddedFeatureId, rectangleSketchFeature } from "../src/onshape-features";
import { CLAUDE_CAD_INSTRUCTIONS, CLAUDE_CAD_TOOLS, callClaudeCadTool } from "../src/claude-cad";
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

  it("skips Fusion loopback when hosted", async () => {
    const status = (await callClaudeCadTool("fusion_status", {}, { hosted: true })) as { setupRequired: boolean };
    expect(status.setupRequired).toBe(true);
  });

  it("refuses Onshape calls when API keys are missing", async () => {
    const saved = {
      ONSHAPE_ACCESS_KEY: process.env.ONSHAPE_ACCESS_KEY,
      ONSHAPE_SECRET_KEY: process.env.ONSHAPE_SECRET_KEY,
      ONSHAPE_API_KEY: process.env.ONSHAPE_API_KEY,
      ONSHAPE_API_SECRET: process.env.ONSHAPE_API_SECRET,
    };
    delete process.env.ONSHAPE_ACCESS_KEY;
    delete process.env.ONSHAPE_SECRET_KEY;
    delete process.env.ONSHAPE_API_KEY;
    delete process.env.ONSHAPE_API_SECRET;
    try {
      await expect(callClaudeCadTool("onshape_list_documents")).rejects.toThrow(/Setup required/i);
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
