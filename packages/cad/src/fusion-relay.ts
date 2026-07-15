import { createHmac, timingSafeEqual } from "node:crypto";
import type { CadAction } from "./agent-policy";

export type CadExecutionResult = {
  externalFeatureId?: string;
  output: Record<string, unknown>;
  topology: { fingerprint: string; summary: Record<string, unknown> };
  render: { mimeType: string; content: string };
  checkpointRef: string;
};

export const FUSION_RELAY_PROTOCOL_VERSION = "2026-07-1";

export type FusionRelayEnvelope = {
  version: string;
  jobId: string;
  stepId: string;
  orgId: string;
  userId: string;
  deviceId: string;
  machineName: string;
  nonce: string;
  leaseToken: string;
  operation: CadAction;
  issuedAt: string;
  expiresAt: string;
  signature: string;
};

function payload(envelope: Omit<FusionRelayEnvelope, "signature">) {
  return JSON.stringify(envelope);
}

export function signFusionRelayJob(
  input: Omit<FusionRelayEnvelope, "signature">,
  secret = process.env.FUSION_RELAY_SIGNING_SECRET ?? "local-fusion-relay-secret",
) {
  return {
    ...input,
    signature: createHmac("sha256", secret).update(payload(input)).digest("base64url"),
  };
}

export function verifyFusionRelayJob(
  envelope: FusionRelayEnvelope,
  secret = process.env.FUSION_RELAY_SIGNING_SECRET ?? "local-fusion-relay-secret",
  now = Date.now(),
) {
  const { signature, ...unsigned } = envelope;
  const expected = createHmac("sha256", secret).update(payload(unsigned)).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return (
    a.length === b.length &&
    timingSafeEqual(a, b) &&
    Date.parse(envelope.expiresAt) > now &&
    envelope.version === FUSION_RELAY_PROTOCOL_VERSION
  );
}

export type FusionRelayProgress = {
  jobId: string;
  stepId: string;
  state: "claimed" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
  progress: number;
  message: string;
  checkpointRef?: string;
  result?: CadExecutionResult;
};

export interface FusionOfficialPluginBridge {
  execute(operation: CadAction, onProgress: (progress: number, message: string) => void): Promise<CadExecutionResult>;
  cancel(): Promise<void>;
  heartbeat(): Promise<{ documentName: string; active: boolean }>;
}

export class FusionRelayReferenceClient {
  constructor(
    private readonly apiBase: string,
    private readonly relayToken: string,
    private readonly bridge: FusionOfficialPluginBridge,
  ) {}

  async heartbeat() {
    const plugin = await this.bridge.heartbeat();
    return fetch(`${this.apiBase}/api/cad/relay/heartbeat`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.relayToken}`, "content-type": "application/json" },
      body: JSON.stringify(plugin),
    });
  }

  async execute(envelope: FusionRelayEnvelope) {
    if (!verifyFusionRelayJob(envelope)) throw new Error("Fusion relay job signature is invalid or expired");
    return this.bridge.execute(envelope.operation, () => {});
  }
}

export function pairingState(
  input: { expiresAt: number; approved: boolean; consumed: boolean },
  now = Date.now(),
) {
  if (input.consumed) return "consumed" as const;
  if (input.expiresAt <= now) return "expired" as const;
  if (input.approved) return "approved" as const;
  return "pending" as const;
}
