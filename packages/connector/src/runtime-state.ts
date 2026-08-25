import { isCapabilityId, type CapabilityId } from "./capability.js";
import { connectorConfigDir } from "./config.js";
import { joinPath, readIfExists, type FileSystemLike } from "./ports.js";
import type { CapabilityRunState, ConnectorStatusReport } from "./supervisor.js";

/**
 * Liveness the RUNNING connector leaves behind so a later `--status` in a different
 * process can answer "when did this thing last talk to the cloud?" honestly instead of
 * printing a zero. Written to ~/.vantage/connector-state.json next to connector.json.
 *
 * Every field is nullable on purpose: absent file = never run, null lastHeartbeatAt =
 * started but no beat has been accepted yet. Nothing here is a secret — the device token
 * lives only in connector.json and must never be copied into this file.
 */

export const RUNTIME_STATE_FILENAME = "connector-state.json";

export function runtimeStatePath(home: string): string {
  return joinPath(connectorConfigDir(home), RUNTIME_STATE_FILENAME);
}

export type RuntimeCapabilitySnapshot = {
  id: CapabilityId;
  label: string;
  enabled: boolean;
  state: CapabilityRunState;
  stateDetail: string;
  /** null until the supervisor has probed this capability at least once. */
  detection: { available: boolean; detail: string } | null;
};

export type ConnectorRuntimeState = {
  version: 1;
  /** OS process id that wrote this file, so status can say whether it is still alive. */
  pid: number | null;
  startedAt: string;
  /** null = the supervisor has not had a heartbeat accepted or rejected yet. */
  lastHeartbeatAt: string | null;
  lastHeartbeatOk: boolean | null;
  lastHeartbeatDetail: string | null;
  /** Set on a clean shutdown; stays null when the process was killed or is still running. */
  stoppedAt: string | null;
  capabilities: RuntimeCapabilitySnapshot[];
};

const RUN_STATES: readonly CapabilityRunState[] = [
  "disabled",
  "detecting",
  "unavailable",
  "running",
  "restarting",
  "stopped",
  "auth-revoked",
];

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseSnapshot(raw: unknown): RuntimeCapabilitySnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (!isCapabilityId(value.id)) return null;
  const state = RUN_STATES.includes(value.state as CapabilityRunState)
    ? (value.state as CapabilityRunState)
    : "stopped";
  const detectionRaw = value.detection;
  const detection =
    detectionRaw && typeof detectionRaw === "object" && !Array.isArray(detectionRaw)
      ? {
          available: (detectionRaw as Record<string, unknown>).available === true,
          detail: asString((detectionRaw as Record<string, unknown>).detail) ?? "",
        }
      : null;
  return {
    id: value.id,
    label: asString(value.label) ?? value.id,
    enabled: value.enabled === true,
    state,
    stateDetail: asString(value.stateDetail) ?? "",
    detection,
  };
}

/** Returns null for anything unusable so callers fall back to "no run recorded". */
export function parseRuntimeState(raw: unknown): ConnectorRuntimeState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const startedAt = asString(value.startedAt);
  if (!startedAt) return null;
  return {
    version: 1,
    pid: Number.isInteger(value.pid) ? (value.pid as number) : null,
    startedAt,
    lastHeartbeatAt: asString(value.lastHeartbeatAt),
    lastHeartbeatOk: typeof value.lastHeartbeatOk === "boolean" ? value.lastHeartbeatOk : null,
    lastHeartbeatDetail: asString(value.lastHeartbeatDetail),
    stoppedAt: asString(value.stoppedAt),
    capabilities: (Array.isArray(value.capabilities) ? value.capabilities : [])
      .map(parseSnapshot)
      .filter((entry): entry is RuntimeCapabilitySnapshot => entry !== null),
  };
}

/** Project a live supervisor report into the persisted snapshot shape. */
export function snapshotFromStatus(report: ConnectorStatusReport): RuntimeCapabilitySnapshot[] {
  return report.capabilities.map((entry) => ({
    id: entry.id,
    label: entry.label,
    enabled: entry.enabled,
    state: entry.state,
    stateDetail: entry.stateDetail,
    detection: entry.detection
      ? { available: entry.detection.available, detail: entry.detection.detail }
      : null,
  }));
}

export async function readRuntimeState(
  fs: FileSystemLike,
  home: string,
): Promise<ConnectorRuntimeState | null> {
  const raw = await readIfExists(fs, runtimeStatePath(home));
  if (raw === null) return null;
  try {
    return parseRuntimeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeRuntimeState(
  fs: FileSystemLike,
  home: string,
  state: ConnectorRuntimeState,
): Promise<void> {
  await fs.mkdir(connectorConfigDir(home), { recursive: true });
  const path = runtimeStatePath(home);
  await fs.writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}
