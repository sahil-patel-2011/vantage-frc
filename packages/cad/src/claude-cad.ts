import { randomUUID } from "node:crypto";
import type { CadOperation } from "./agent-policy";
import { FUSION_RELAY_PROTOCOL_VERSION, signFusionRelayJob } from "./fusion-relay";
import { loadClaudeCadSession, requireBoundDocument, saveClaudeCadSession } from "./claude-session";
import {
  createOnshapeApiKeyHttp,
  onshapeApiKeysStatus,
  onshapeHttpError,
  readOnshapeApiKeys,
  readOnshapeJson,
} from "./onshape-api-keys";
import { extrudeFeature, parseAddedFeatureId, rectangleSketchFeature } from "./onshape-features";

export const CLAUDE_CAD_INSTRUCTIONS = `Vantage CAD from Claude Code (terminal)

Onshape (cloud, any OS)
1. Create an API key pair: https://dev-portal.onshape.com/keys
2. In this terminal:
   PowerShell:  $env:ONSHAPE_ACCESS_KEY="..."; $env:ONSHAPE_SECRET_KEY="..."
   bash:        export ONSHAPE_ACCESS_KEY=... ONSHAPE_SECRET_KEY=...
3. Open a disposable Onshape document + Part Studio (do not test in a competition robot doc).
4. Ask Claude: "list my Onshape documents" then "bind that Part Studio and sketch a 40x20 mm rectangle, extrude 10 mm".

Fusion 360 (Windows/macOS only — never hosted)
1. Install Autodesk Fusion and the Vantage add-in:
   powershell -ExecutionPolicy Bypass -File .\\scripts\\cad\\install-windows.ps1
2. In Fusion: Utilities → Add-Ins → run VantageCadRelay (listens on 127.0.0.1:32145).
3. Open a disposable design. Ask Claude: "sketch a 40x20 mm rectangle in Fusion and extrude 10 mm".

Claude Code MCP (from the repo root)
  claude mcp add vantage-cad -- node packages/vantage-cad-cli/bin/vantage-cad.mjs mcp
or keep the checked-in .mcp.json and restart Claude Code.

CLI without MCP
  vantage-cad claude
  vantage-cad onshape docs
  vantage-cad fusion ping

Never paste API secrets into chat. Not certified engineering software.`;

export const CLAUDE_CAD_TOOLS = [
  {
    name: "cad_status",
    description: "Show whether Onshape API keys and the local Fusion add-in are ready.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "cad_setup",
    description: "Return short setup steps for Onshape API keys and Fusion 360 local add-in.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "onshape_list_documents",
    description: "List recent Onshape documents for the API-key account.",
    inputSchema: { type: "object", properties: { limit: { type: "number" } }, additionalProperties: false },
  },
  {
    name: "onshape_list_elements",
    description: "List elements (Part Studios) in an Onshape document workspace.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string" },
        workspaceId: { type: "string" },
      },
      required: ["documentId", "workspaceId"],
      additionalProperties: false,
    },
  },
  {
    name: "onshape_bind",
    description: "Remember the Part Studio Claude will edit this session (disposable docs only).",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string" },
        workspaceId: { type: "string" },
        elementId: { type: "string" },
        documentName: { type: "string" },
      },
      required: ["documentId", "workspaceId", "elementId"],
      additionalProperties: false,
    },
  },
  {
    name: "onshape_describe",
    description: "List features in the bound Onshape Part Studio.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "onshape_sketch_rectangle",
    description: "Add a rectangle sketch on Front/Top/Right. Dimensions in millimeters.",
    inputSchema: {
      type: "object",
      properties: {
        widthMm: { type: "number" },
        heightMm: { type: "number" },
        plane: { type: "string", description: "Front, Top, or Right" },
        name: { type: "string" },
      },
      required: ["widthMm", "heightMm"],
      additionalProperties: false,
    },
  },
  {
    name: "onshape_extrude",
    description: "Extrude the last (or given) sketch into a new solid. Depth in millimeters.",
    inputSchema: {
      type: "object",
      properties: {
        depthMm: { type: "number" },
        sketchFeatureId: { type: "string" },
        name: { type: "string" },
      },
      required: ["depthMm"],
      additionalProperties: false,
    },
  },
  {
    name: "fusion_status",
    description: "Ping the local Fusion VantageCadRelay add-in on loopback.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "fusion_describe",
    description: "Verify the open Fusion design (body/feature counts). Fusion must be running with VantageCadRelay.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "fusion_sketch_rectangle",
    description: "Create a rectangle sketch in the active Fusion design. Dimensions in millimeters.",
    inputSchema: {
      type: "object",
      properties: {
        widthMm: { type: "number" },
        heightMm: { type: "number" },
        name: { type: "string" },
      },
      required: ["widthMm", "heightMm"],
      additionalProperties: false,
    },
  },
  {
    name: "fusion_extrude",
    description: "Extrude the latest Fusion sketch. Depth in millimeters. Fusion add-in must be running.",
    inputSchema: {
      type: "object",
      properties: { depthMm: { type: "number" } },
      required: ["depthMm"],
      additionalProperties: false,
    },
  },
] as const;

export type ClaudeCadToolName = (typeof CLAUDE_CAD_TOOLS)[number]["name"];

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fusionEndpoint() {
  const raw = (process.env.FUSION_PLUGIN_URL ?? "http://127.0.0.1:32145").trim();
  const url = new URL(raw);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("Fusion plugin URL must be loopback (127.0.0.1).");
  }
  return url.toString().replace(/\/$/, "");
}

async function requireOnshapeHttp() {
  const creds = readOnshapeApiKeys();
  if (!creds) throw new Error(onshapeApiKeysStatus().message);
  return createOnshapeApiKeyHttp(creds);
}

async function fusionExecute(operation: string, parameters: Record<string, unknown>) {
  const envelope = signFusionRelayJob({
    version: FUSION_RELAY_PROTOCOL_VERSION,
    jobId: `claude-${randomUUID()}`,
    stepId: `step-${randomUUID().slice(0, 8)}`,
    orgId: "local-claude",
    userId: "local-claude",
    deviceId: "claude-code",
    machineName: "claude-code",
    nonce: randomUUID(),
    leaseToken: "claude-local",
    operation: {
      operation: operation as CadOperation,
      parameters,
      requiresApproval: true,
      reason: "Claude Code local Fusion tool",
    },
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const response = await fetch(`${fusionEndpoint()}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(envelope),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String((body as { error?: string }).error ?? `Fusion execute HTTP ${response.status}`));
  }
  return body;
}

export async function callClaudeCadTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (name) {
    case "cad_setup":
      return { instructions: CLAUDE_CAD_INSTRUCTIONS };
    case "cad_status": {
      const keys = onshapeApiKeysStatus();
      const session = await loadClaudeCadSession();
      let fusion: unknown = { reachable: false };
      try {
        const response = await fetch(`${fusionEndpoint()}/health`, { signal: AbortSignal.timeout(3_000) });
        fusion = { reachable: response.ok, ...(await response.json().catch(() => ({}))) };
      } catch {
        fusion = {
          reachable: false,
          setupRequired: true,
          message:
            "Fusion add-in is not listening on 127.0.0.1:32145. Open Fusion → run VantageCadRelay. Linux has no Fusion — use Onshape.",
        };
      }
      return {
        onshape: keys,
        boundPartStudio: session.documentId
          ? {
              documentId: session.documentId,
              workspaceId: session.workspaceId,
              elementId: session.elementId,
              documentName: session.documentName ?? null,
            }
          : null,
        fusion,
        disclaimer: "Not certified engineering software. Use a disposable document.",
      };
    }
    case "onshape_list_documents": {
      const http = await requireOnshapeHttp();
      const limit = Math.min(40, Math.max(1, Math.floor(num(args.limit, 12))));
      const response = await http(`/documents?filter=0&offset=0&limit=${limit}`);
      const body = (await readOnshapeJson(response)) as { items?: Array<Record<string, unknown>> };
      if (!response.ok) throw onshapeHttpError(response.status, body);
      return {
        documents: (body.items ?? []).map((item) => ({
          id: String(item.id),
          name: String(item.name ?? "Untitled"),
          defaultWorkspaceId: item.defaultWorkspace
            ? String((item.defaultWorkspace as { id?: string }).id ?? "")
            : "",
        })),
      };
    }
    case "onshape_list_elements": {
      const http = await requireOnshapeHttp();
      const documentId = str(args.documentId);
      const workspaceId = str(args.workspaceId);
      const response = await http(`/documents/d/${documentId}/w/${workspaceId}/elements`);
      const body = await readOnshapeJson(response);
      if (!response.ok) throw onshapeHttpError(response.status, body);
      const items = Array.isArray(body) ? body : ((body as { items?: unknown[] }).items ?? []);
      return {
        elements: (items as Array<Record<string, unknown>>).map((item) => ({
          id: String(item.id),
          name: String(item.name ?? "Element"),
          elementType: String(item.elementType ?? item.type ?? ""),
        })),
      };
    }
    case "onshape_bind": {
      const session = {
        documentId: str(args.documentId),
        workspaceId: str(args.workspaceId),
        elementId: str(args.elementId),
        documentName: str(args.documentName) || undefined,
      };
      if (!session.documentId || !session.workspaceId || !session.elementId) {
        throw new Error("documentId, workspaceId, and elementId are required.");
      }
      await saveClaudeCadSession(session);
      return { bound: session, note: "Edits go to this Part Studio until you bind another." };
    }
    case "onshape_describe": {
      const http = await requireOnshapeHttp();
      const doc = requireBoundDocument(await loadClaudeCadSession());
      const response = await http(
        `/partstudios/d/${doc.documentId}/w/${doc.workspaceId}/e/${doc.elementId}/features`,
      );
      const body = (await readOnshapeJson(response)) as { features?: Array<Record<string, unknown>> };
      if (!response.ok) throw onshapeHttpError(response.status, body);
      return {
        features: (body.features ?? []).map((feature) => {
          const message = feature.message as Record<string, unknown> | undefined;
          return {
            id: String(feature.featureId ?? feature.nodeId ?? ""),
            name: String(message?.name ?? feature.name ?? "Feature"),
            featureType: String(message?.featureType ?? feature.featureType ?? "unknown"),
          };
        }),
      };
    }
    case "onshape_sketch_rectangle": {
      const http = await requireOnshapeHttp();
      const session = await loadClaudeCadSession();
      const doc = requireBoundDocument(session);
      const payload = rectangleSketchFeature({
        widthMm: num(args.widthMm, 40),
        heightMm: num(args.heightMm, 40),
        plane: str(args.plane) || "Top",
        name: str(args.name) || undefined,
      });
      const response = await http(
        `/partstudios/d/${doc.documentId}/w/${doc.workspaceId}/e/${doc.elementId}/features`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      const body = await readOnshapeJson(response);
      if (!response.ok) throw onshapeHttpError(response.status, body);
      const featureId = parseAddedFeatureId(body);
      await saveClaudeCadSession({ ...session, lastSketchFeatureId: featureId });
      return { ok: true, featureId, operation: "create_sketch" };
    }
    case "onshape_extrude": {
      const http = await requireOnshapeHttp();
      const session = await loadClaudeCadSession();
      const doc = requireBoundDocument(session);
      const sketchFeatureId = str(args.sketchFeatureId) || session.lastSketchFeatureId || "";
      const payload = extrudeFeature({
        depthMm: num(args.depthMm, 10),
        sketchFeatureId,
        name: str(args.name) || undefined,
      });
      const response = await http(
        `/partstudios/d/${doc.documentId}/w/${doc.workspaceId}/e/${doc.elementId}/features`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      const body = await readOnshapeJson(response);
      if (!response.ok) throw onshapeHttpError(response.status, body);
      return { ok: true, featureId: parseAddedFeatureId(body), operation: "create_extrude" };
    }
    case "fusion_status": {
      try {
        const response = await fetch(`${fusionEndpoint()}/health`, { signal: AbortSignal.timeout(3_000) });
        const body = await response.json().catch(() => ({}));
        return { reachable: response.ok, ...body };
      } catch {
        return {
          reachable: false,
          setupRequired: true,
          message:
            "Fusion add-in is not listening on 127.0.0.1:32145. Open Fusion → run VantageCadRelay. Linux has no Fusion — use Onshape.",
        };
      }
    }
    case "fusion_describe":
      return fusionExecute("verify_topology", {});
    case "fusion_sketch_rectangle":
      return fusionExecute("create_sketch", {
        widthMm: num(args.widthMm, 40),
        heightMm: num(args.heightMm, 40),
        name: str(args.name) || "VantageSketch",
      });
    case "fusion_extrude":
      return fusionExecute("create_extrude", { depthMm: num(args.depthMm, 10) });
    default:
      throw new Error(`Unknown CAD tool "${name}".`);
  }
}
