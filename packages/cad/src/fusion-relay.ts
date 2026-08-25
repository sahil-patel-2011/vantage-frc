import { createHmac, timingSafeEqual } from "node:crypto";
import type { CadAction } from "./agent-policy";

export type CadExecutionResult = {
  externalFeatureId?: string;
  output: Record<string, unknown>;
  topology: { fingerprint: string; summary: Record<string, unknown> };
  render: { mimeType: string; content: string };
  checkpointRef: string;
};

/** Current signed-job envelope protocol. Bump when wire format or verify rules change. */
export const FUSION_RELAY_PROTOCOL_VERSION = "2026-07-1";

/**
 * Protocols the server will accept on claim/verify.
 * Keep historical ids only while dual-running a migration window.
 */
export const FUSION_RELAY_SUPPORTED_PROTOCOLS = [FUSION_RELAY_PROTOCOL_VERSION] as const;

export type FusionRelayProtocolVersion = (typeof FUSION_RELAY_SUPPORTED_PROTOCOLS)[number];

/**
 * Operations the VantageCadRelay Fusion add-in actually executes.
 *
 * This is the ONE list that decides `fusion: "supported"` in cad-tool-catalog.ts,
 * so the /cad tools panel can never claim an operation the add-in refuses. It is
 * kept byte-for-byte in sync with `IMPLEMENTED` in
 * packages/fusion360-official-connector/VantageCadRelay/VantageCadRelay.py, which
 * publishes the same list on GET /health — `assertFusionRelayParity()` compares
 * the two at runtime so a stale add-in is reported, not discovered mid-build.
 */
export const FUSION_RELAY_IMPLEMENTED_OPERATIONS = [
  "create_chamfer",
  "create_checkpoint",
  "create_extrude",
  "create_fillet",
  "create_sketch",
  "delete_feature",
  "render_views",
  "verify_topology",
] as const;

export type FusionRelayImplementedOperation = (typeof FUSION_RELAY_IMPLEMENTED_OPERATIONS)[number];

export function fusionRelayImplements(operation: string): boolean {
  return (FUSION_RELAY_IMPLEMENTED_OPERATIONS as readonly string[]).includes(operation);
}

/**
 * Compare the running add-in's advertised operations against what this build of
 * Vantage expects. Returns the honest difference instead of assuming parity.
 * `advertised` is the `operations` array from the relay's /health response;
 * add-ins older than 0.2.0 do not send it, which is reported as "unknown".
 */
export function assertFusionRelayParity(advertised: unknown): {
  known: boolean;
  inSync: boolean;
  missingFromAddin: string[];
  extraInAddin: string[];
  note: string;
} {
  if (!Array.isArray(advertised)) {
    return {
      known: false,
      inSync: false,
      missingFromAddin: [],
      extraInAddin: [],
      note: "This Fusion add-in does not report its operations (older than v0.2.0). Run `vantage-cad update` to reinstall the add-in, then restart VantageCadRelay in Fusion.",
    };
  }
  const addin = new Set(advertised.map((item) => String(item)));
  const expected = new Set<string>(FUSION_RELAY_IMPLEMENTED_OPERATIONS);
  const missingFromAddin = [...expected].filter((op) => !addin.has(op)).sort();
  const extraInAddin = [...addin].filter((op) => !expected.has(op)).sort();
  const inSync = missingFromAddin.length === 0 && extraInAddin.length === 0;
  return {
    known: true,
    inSync,
    missingFromAddin,
    extraInAddin,
    note: inSync
      ? "Fusion add-in operations match this Vantage build."
      : missingFromAddin.length
        ? `The installed add-in cannot run: ${missingFromAddin.join(", ")}. Run \`vantage-cad update\`, then restart VantageCadRelay in Fusion.`
        : `The installed add-in is newer than this Vantage build (extra: ${extraInAddin.join(", ")}). Run \`vantage-cad update\` to match versions.`,
  };
}

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
    (FUSION_RELAY_SUPPORTED_PROTOCOLS as readonly string[]).includes(envelope.version)
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
