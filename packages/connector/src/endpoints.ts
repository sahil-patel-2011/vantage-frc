/**
 * Cloud endpoint paths the connector talks to, in one place so hosts can override any of
 * them without forking capability code.
 *
 * Two groups:
 *  - `pairStart` / `pairPoll` / `heartbeat` are the CONNECTOR endpoints. They follow the
 *    canonical device-pairing wire contract from packages/db/migrations/0486_ai_bridge.sql
 *    (8-char user code, poll token, sha256-hashed device token) but do NOT exist server-side
 *    yet — wiring them is the deployment owner's step (see docs/LOCAL_RELAY.md).
 *  - The remaining paths are the endpoints that already exist today, one per consolidated
 *    service. A config adopted from ~/.vantage/ai-bridge.json keeps working against
 *    `aiBridgeJobs`/`aiBridgeHeartbeat` with its existing device token.
 */
export type ConnectorEndpoints = {
  pairStart: string;
  pairPoll: string;
  /** Combined connector heartbeat (one beat for all capabilities). */
  heartbeat: string;
  /** Existing AI-bridge job queue (claim = POST, report = PATCH). */
  aiBridgeJobs: string;
  /** Existing per-service heartbeat, useful while only the bridge endpoints are live. */
  aiBridgeHeartbeat: string;
  /** Existing CAD relay queue (claim = POST, report = PATCH). */
  cadRelayJobs: string;
  cadRelayHeartbeat: string;
  /** Existing team agent-config bundle (rules/skills/subagents/MCP/permissions). */
  agentConfigBundle: string;
  /** Existing storage-node heartbeat (disk stats + scrub honesty exchange). */
  storageHeartbeat: string;
};

export const DEFAULT_CONNECTOR_ENDPOINTS: ConnectorEndpoints = {
  pairStart: "/api/connector/pair/start",
  pairPoll: "/api/connector/pair/poll",
  heartbeat: "/api/connector/heartbeat",
  aiBridgeJobs: "/api/ai-bridge/device/jobs",
  aiBridgeHeartbeat: "/api/ai-bridge/device/heartbeat",
  cadRelayJobs: "/api/cad/relay/jobs",
  cadRelayHeartbeat: "/api/cad/relay/heartbeat",
  agentConfigBundle: "/api/agent-config/bundle",
  storageHeartbeat: "/api/storage-node/heartbeat",
};

export function resolveEndpoints(overrides?: Partial<ConnectorEndpoints>): ConnectorEndpoints {
  return { ...DEFAULT_CONNECTOR_ENDPOINTS, ...(overrides ?? {}) };
}

/** Compose a cloud URL from the paired base URL and an endpoint path. */
export function cloudUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}
