import type { Clock, FileSystemLike, JsonHttpTransport, Logger, Spawner } from "./ports.js";
import type { ConnectorConfig } from "./config.js";
import type { ConnectorEndpoints } from "./endpoints.js";

/** The six things one paired connector machine can do for its team. */
export const CAPABILITY_IDS = [
  "ai-bridge",
  "cad-relay",
  "local-models",
  "agent-sync",
  "storage-node",
  "mcp",
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export function isCapabilityId(value: unknown): value is CapabilityId {
  return typeof value === "string" && (CAPABILITY_IDS as readonly string[]).includes(value);
}

/** Everything a capability may touch. Injected by the supervisor; nothing global. */
export type CapabilityContext = {
  config: ConnectorConfig;
  endpoints: ConnectorEndpoints;
  transport: JsonHttpTransport;
  spawner: Spawner;
  fs: FileSystemLike;
  clock: Clock;
  log: Logger;
  /** Aborted when the capability must stop; every internal loop/sleep must honor it. */
  signal: AbortSignal;
};

export type CapabilityDetection = {
  /** Can this machine usefully run the capability right now? */
  available: boolean;
  /** Honest human-readable reason ("Claude CLI 2.1.241 signed in", "Fusion add-in not running"). */
  detail: string;
  /** Structured detection facts (engine versions, endpoints probed, dirs found…). */
  data?: Record<string, unknown>;
};

/** Capability-owned live report; the supervisor wraps it with lifecycle state. */
export type CapabilityReport = {
  detail: string;
  data?: Record<string, unknown>;
};

/**
 * The common capability interface. Contract:
 *  - `detect` never throws; it answers honestly (including "setup required" states).
 *  - `start(ctx)` runs the capability until `ctx.signal` aborts, then RESOLVES. A rejection
 *    (or an early resolution while the signal is still live) is a crash: the supervisor
 *    restarts with backoff. Throwing ConnectorAuthError is fatal — no restart, the token
 *    was revoked and a human must re-pair.
 *  - `stop` is idempotent and releases anything `signal` abortion alone cannot (sockets…).
 *  - `status` is a cheap synchronous snapshot, safe to call at any time from heartbeats.
 */
export interface ConnectorCapability {
  readonly id: CapabilityId;
  readonly label: string;
  detect(ctx: CapabilityContext): Promise<CapabilityDetection>;
  start(ctx: CapabilityContext): Promise<void>;
  stop(): Promise<void>;
  status(): CapabilityReport;
  /** Optional: per-capability instructions delivered in the combined heartbeat response. */
  onHeartbeatResponse?(data: Record<string, unknown>): void;
}

/**
 * Thrown when the cloud answers 401 for the device token: the device was revoked in
 * Vantage. Restarting cannot fix it, so the supervisor stops the capability (or the whole
 * connector, for the shared heartbeat) and surfaces "re-pair" to the host UI.
 */
export class ConnectorAuthError extends Error {
  constructor(message = "Device token was revoked in Vantage. Re-pair this connector.") {
    super(message);
    this.name = "ConnectorAuthError";
  }
}
