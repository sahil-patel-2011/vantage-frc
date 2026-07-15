import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import {
  FUSION_RELAY_PROTOCOL_VERSION,
  signFusionRelayJob,
  verifyFusionRelayJob,
  type FusionRelayEnvelope,
} from "./fusion-relay";
import type { CadAction } from "./agent-policy";

export const MOCK_FUSION_PLUGIN_PORT = 32145;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Deterministic mock Fusion add-in for CI and local demos (no Autodesk required). */
export function createMockFusionPluginHandler(secret = process.env.FUSION_RELAY_SIGNING_SECRET ?? "local-fusion-relay-secret") {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, {
        ok: true,
        mock: true,
        protocol: FUSION_RELAY_PROTOCOL_VERSION,
        documentName: "Vantage Mock Document",
        active: true,
      });
    }
    if (req.method === "POST" && url.pathname === "/execute") {
      const raw = await readBody(req);
      let envelope: FusionRelayEnvelope;
      try {
        envelope = JSON.parse(raw) as FusionRelayEnvelope;
      } catch {
        return json(res, 400, { error: "Invalid JSON envelope" });
      }
      if (!verifyFusionRelayJob(envelope, secret)) {
        return json(res, 401, { error: "Invalid or expired signed job" });
      }
      const operation = envelope.operation as CadAction;
      const fingerprint = createHash("sha256")
        .update(`${envelope.jobId}:${envelope.stepId}:${operation.operation}`)
        .digest("hex");
      return json(res, 200, {
        externalFeatureId: `mock-fusion-${envelope.stepId}`,
        output: { operation: operation.operation, mockFusion: true },
        topology: {
          fingerprint,
          summary: { bodies: 1, features: 1, validation: "mock-fusion-pass" },
        },
        render: {
          mimeType: "image/svg+xml",
          content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><rect width="800" height="450" fill="#101820"/><text x="40" y="240" fill="#7dd3fc" font-size="28">Mock Fusion · ${operation.operation}</text></svg>`,
        },
        checkpointRef: `mock-fusion-checkpoint-${envelope.stepId}`,
      });
    }
    return json(res, 404, { error: "Not found" });
  };
}

export function startMockFusionPluginServer(port = MOCK_FUSION_PLUGIN_PORT) {
  const handler = createMockFusionPluginHandler();
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  return new Promise<typeof server>((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

/** Helper for tests: sign a tiny envelope then verify through mock handler semantics. */
export function buildTestFusionEnvelope(overrides: Partial<Omit<FusionRelayEnvelope, "signature">> = {}) {
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  return signFusionRelayJob({
    version: FUSION_RELAY_PROTOCOL_VERSION,
    jobId: "job-test",
    stepId: "step-test",
    orgId: "org-test",
    userId: "user-test",
    deviceId: "device-test",
    machineName: "ci",
    nonce: "nonce-test",
    leaseToken: "lease-test",
    operation: {
      operation: "verify_topology",
      parameters: { views: ["iso"] },
      requiresApproval: true,
      reason: "test",
    },
    issuedAt,
    expiresAt,
    ...overrides,
  });
}
