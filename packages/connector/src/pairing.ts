import { CONNECTOR_VERSION } from "./version.js";
import { cloudUrl, type ConnectorEndpoints } from "./endpoints.js";
import { defaultCapabilities, type CapabilityToggleMap, type ConnectorConfig } from "./config.js";
import type { Clock, JsonHttpTransport } from "./ports.js";

/**
 * Connector pairing — the canonical Vantage device-pairing flow (0486_ai_bridge.sql):
 * the device asks the cloud to start a pairing, shows the human an 8-character code and a
 * verification URL, then polls with its secret poll token until a signed-in owner/admin
 * approves the code in the browser. The cloud answers with a device token whose sha256
 * hash (never the plaintext) is what it stores. Ported from bridge.mjs `setup()` with the
 * storage-node deadline handling, restructured as an inspectable state machine so hosts
 * (Electron UI, headless CLI) can render each phase instead of blocking on one function.
 */

export type PairingStartResponse = {
  userCode: string;
  verificationUri: string;
  pollToken: string;
  /** Poll interval in seconds (server-suggested; default 3, floor 2 like storage-node). */
  interval?: number;
  /** Approval window in seconds (default 600 — the 10-minute window). */
  expiresIn?: number;
};

export type ApprovedPairing = {
  deviceToken: string;
  deviceId: string | null;
  orgId: string | null;
};

export type PairingState =
  | { phase: "idle" }
  | {
      phase: "waiting_approval";
      userCode: string;
      verificationUri: string;
      intervalMs: number;
      expiresAt: number;
    }
  | { phase: "approved"; result: ApprovedPairing }
  | { phase: "failed"; reason: "denied" | "expired" | "error"; detail: string };

export type PairingFlowOptions = {
  transport: JsonHttpTransport;
  clock: Clock;
  baseUrl: string;
  machineName: string;
  endpoints: Pick<ConnectorEndpoints, "pairStart" | "pairPoll">;
  /** Capabilities the human pre-selected in the host UI; sent for the approval page. */
  requestedCapabilities?: string[];
  signal?: AbortSignal;
};

export class PairingFlow {
  private stateValue: PairingState = { phase: "idle" };
  private pollToken: string | null = null;

  constructor(private readonly options: PairingFlowOptions) {}

  get state(): PairingState {
    return this.stateValue;
  }

  /** Ask the cloud to start a pairing. Transitions idle → waiting_approval (or failed). */
  async start(): Promise<PairingState> {
    const { transport, clock, baseUrl, machineName, endpoints } = this.options;
    let response;
    try {
      response = await transport.postJson(cloudUrl(baseUrl, endpoints.pairStart), {
        machineName,
        connectorVersion: CONNECTOR_VERSION,
        capabilities: this.options.requestedCapabilities ?? [],
      });
    } catch (error) {
      this.stateValue = {
        phase: "failed",
        reason: "error",
        detail: `Could not reach ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      };
      return this.stateValue;
    }
    const data = response.data;
    const userCode = typeof data.userCode === "string" ? data.userCode : null;
    const pollToken = typeof data.pollToken === "string" ? data.pollToken : null;
    if (!response.ok || !userCode || !pollToken) {
      this.stateValue = {
        phase: "failed",
        reason: "error",
        detail: typeof data.error === "string" ? data.error : "Pairing could not start",
      };
      return this.stateValue;
    }
    // Never log/print pollToken — it is the device-side secret for this pairing session.
    this.pollToken = pollToken;
    const intervalSeconds = typeof data.interval === "number" && Number.isFinite(data.interval) ? data.interval : 3;
    const expiresIn = typeof data.expiresIn === "number" && Number.isFinite(data.expiresIn) ? data.expiresIn : 600;
    this.stateValue = {
      phase: "waiting_approval",
      userCode,
      verificationUri:
        typeof data.verificationUri === "string" && data.verificationUri
          ? data.verificationUri
          : cloudUrl(baseUrl, "/team"),
      intervalMs: Math.max(2, intervalSeconds) * 1000,
      expiresAt: clock.now() + expiresIn * 1000,
    };
    return this.stateValue;
  }

  /**
   * One poll. pending → stays waiting; approved → approved; anything else → failed.
   * Local expiry is enforced too, so a silent server never leaves the device waiting forever.
   */
  async pollOnce(): Promise<PairingState> {
    const current = this.stateValue;
    if (current.phase !== "waiting_approval" || !this.pollToken) return this.stateValue;
    const { transport, clock, baseUrl, endpoints } = this.options;
    if (clock.now() >= current.expiresAt) {
      this.stateValue = {
        phase: "failed",
        reason: "expired",
        detail: "Pairing code expired before it was approved. Start pairing again.",
      };
      return this.stateValue;
    }
    let response;
    try {
      response = await transport.postJson(cloudUrl(baseUrl, endpoints.pairPoll), { pollToken: this.pollToken });
    } catch {
      // Transient network blip mid-pairing: stay in waiting_approval and try again.
      return this.stateValue;
    }
    const data = response.data;
    if (data.status === "pending") return this.stateValue;
    if (data.status === "approved" && typeof data.deviceToken === "string" && data.deviceToken) {
      this.stateValue = {
        phase: "approved",
        result: {
          deviceToken: data.deviceToken,
          deviceId: typeof data.deviceId === "string" ? data.deviceId : null,
          orgId: typeof data.orgId === "string" ? data.orgId : null,
        },
      };
      return this.stateValue;
    }
    const status = typeof data.status === "string" ? data.status : "failed";
    this.stateValue = {
      phase: "failed",
      reason: status === "denied" ? "denied" : "error",
      detail: `Pairing ${status}${typeof data.error === "string" && data.error ? `: ${data.error}` : ""}`,
    };
    return this.stateValue;
  }

  /** Convenience loop for hosts that just want to block until the human decides. */
  async waitForApproval(): Promise<PairingState> {
    if (this.stateValue.phase === "idle") await this.start();
    while (this.stateValue.phase === "waiting_approval") {
      if (this.options.signal?.aborted) {
        this.stateValue = { phase: "failed", reason: "error", detail: "Pairing was cancelled." };
        break;
      }
      await this.options.clock.sleep(this.stateValue.intervalMs, this.options.signal);
      await this.pollOnce();
    }
    return this.stateValue;
  }
}

/** Turn an approved pairing into a saved-shape connector config. */
export function configFromPairing(
  approved: ApprovedPairing,
  options: { baseUrl: string; machineName: string; capabilities?: CapabilityToggleMap },
): ConnectorConfig {
  return {
    version: 1,
    baseUrl: options.baseUrl,
    machineName: options.machineName,
    deviceToken: approved.deviceToken,
    deviceId: approved.deviceId,
    orgId: approved.orgId,
    capabilities: options.capabilities ?? defaultCapabilities(),
  };
}
