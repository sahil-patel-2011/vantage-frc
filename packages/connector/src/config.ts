import { CAPABILITY_IDS, isCapabilityId, type CapabilityId } from "./capability.js";
import { joinPath, readIfExists, type FileSystemLike } from "./ports.js";

/**
 * One config file for the whole connector: one pairing, one device token, one machine —
 * with per-capability toggles. Stored at ~/.vantage/connector.json with mode 0600
 * (the same directory and permission discipline as the AI bridge's ai-bridge.json).
 */

export type CapabilityToggleMap = Partial<Record<CapabilityId, boolean>>;

export type ConnectorConfig = {
  version: 1;
  baseUrl: string;
  machineName: string;
  /** Cloud-issued device token. The cloud stores only its sha256 hash (0486 pattern). */
  deviceToken: string;
  deviceId: string | null;
  orgId: string | null;
  /** Absent id = disabled. Nothing runs until a human turns it on. */
  capabilities: CapabilityToggleMap;
  /** Extra user-configured OpenAI-compatible base URLs to probe for local models. */
  localModels?: { extraBaseUrls: string[] };
  /** Repositories to materialize team agent config into (Claude Code / Cursor). */
  agentSync?: { dirs: string[]; agent?: "claude" | "cursor" | "all" };
  /** Self-hosted media serving. accessKeyHash is sha256 hex of the key minted at enable time. */
  storage?: { dir?: string; port?: number; quotaBytes?: number; accessKeyHash?: string };
  cadRelay?: { pluginEndpoint?: string };
  /** Present when this config was adopted from an existing ai-bridge.json pairing. */
  adopted?: { from: "ai-bridge"; at: string };
};

export const CONNECTOR_CONFIG_FILENAME = "connector.json";
export const LEGACY_BRIDGE_CONFIG_FILENAME = "ai-bridge.json";

export function connectorConfigDir(home: string): string {
  return joinPath(home, ".vantage");
}

export function connectorConfigPath(home: string): string {
  return joinPath(home, ".vantage", CONNECTOR_CONFIG_FILENAME);
}

export function legacyBridgeConfigPath(home: string): string {
  return joinPath(home, ".vantage", LEGACY_BRIDGE_CONFIG_FILENAME);
}

/** Fresh pairings start with every capability off — enabling each one is a human choice. */
export function defaultCapabilities(): CapabilityToggleMap {
  return {};
}

export function isCapabilityEnabled(config: ConnectorConfig, id: CapabilityId): boolean {
  return config.capabilities[id] === true;
}

export function enabledCapabilities(config: ConnectorConfig): CapabilityId[] {
  return CAPABILITY_IDS.filter((id) => isCapabilityEnabled(config, id));
}

/** Pure toggle — returns a new config, never mutates. */
export function setCapabilityEnabled(
  config: ConnectorConfig,
  id: CapabilityId,
  enabled: boolean,
): ConnectorConfig {
  return { ...config, capabilities: { ...config.capabilities, [id]: enabled } };
}

function sanitizeToggles(raw: unknown): CapabilityToggleMap {
  const out: CapabilityToggleMap = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isCapabilityId(key) && typeof value === "boolean") out[key] = value;
  }
  return out;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Validate a parsed connector.json. Returns null for anything unusable (wrong shape, no
 * device token) so callers treat it as "not paired" instead of running half-configured.
 */
export function parseConnectorConfig(raw: unknown): ConnectorConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const baseUrl = asString(value.baseUrl);
  const deviceToken = asString(value.deviceToken);
  if (!baseUrl || !deviceToken) return null;
  const config: ConnectorConfig = {
    version: 1,
    baseUrl,
    machineName: asString(value.machineName) ?? "connector",
    deviceToken,
    deviceId: asString(value.deviceId),
    orgId: asString(value.orgId),
    capabilities: sanitizeToggles(value.capabilities),
  };
  if (value.localModels && typeof value.localModels === "object") {
    config.localModels = {
      extraBaseUrls: asStringArray((value.localModels as Record<string, unknown>).extraBaseUrls),
    };
  }
  if (value.agentSync && typeof value.agentSync === "object") {
    const sync = value.agentSync as Record<string, unknown>;
    const agent = asString(sync.agent);
    config.agentSync = {
      dirs: asStringArray(sync.dirs),
      ...(agent === "claude" || agent === "cursor" || agent === "all" ? { agent } : {}),
    };
  }
  if (value.storage && typeof value.storage === "object") {
    const storage = value.storage as Record<string, unknown>;
    config.storage = {
      ...(asString(storage.dir) ? { dir: asString(storage.dir)! } : {}),
      ...(Number.isInteger(storage.port) ? { port: storage.port as number } : {}),
      ...(Number.isFinite(storage.quotaBytes) ? { quotaBytes: storage.quotaBytes as number } : {}),
      ...(asString(storage.accessKeyHash) ? { accessKeyHash: asString(storage.accessKeyHash)! } : {}),
    };
  }
  if (value.cadRelay && typeof value.cadRelay === "object") {
    const relay = value.cadRelay as Record<string, unknown>;
    const endpoint = asString(relay.pluginEndpoint);
    if (endpoint) config.cadRelay = { pluginEndpoint: endpoint };
  }
  if (value.adopted && typeof value.adopted === "object") {
    const adopted = value.adopted as Record<string, unknown>;
    if (adopted.from === "ai-bridge" && asString(adopted.at)) {
      config.adopted = { from: "ai-bridge", at: asString(adopted.at)! };
    }
  }
  return config;
}

/**
 * Adopt an existing ~/.vantage/ai-bridge.json pairing (pure). The legacy file's exact
 * shape comes from bridge.mjs `saveConfig({ ...config, deviceToken, deviceId, orgId })`
 * where config = { baseUrl, machineName }:
 *   { "baseUrl": …, "machineName": …, "deviceToken": …, "deviceId": …, "orgId": … }
 * The one device token carries over — the member is NOT re-paired — and `ai-bridge` is the
 * only capability enabled, because that is exactly what the machine was already doing.
 */
export function adoptLegacyBridgeConfig(raw: unknown, nowIso: string): ConnectorConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const baseUrl = asString(value.baseUrl);
  const deviceToken = asString(value.deviceToken);
  if (!baseUrl || !deviceToken) return null;
  return {
    version: 1,
    baseUrl,
    machineName: asString(value.machineName) ?? "connector",
    deviceToken,
    deviceId: asString(value.deviceId),
    orgId: asString(value.orgId),
    capabilities: { "ai-bridge": true },
    adopted: { from: "ai-bridge", at: nowIso },
  };
}

export async function loadConnectorConfig(fs: FileSystemLike, home: string): Promise<ConnectorConfig | null> {
  const raw = await readIfExists(fs, connectorConfigPath(home));
  if (raw === null) return null;
  try {
    return parseConnectorConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveConnectorConfig(
  fs: FileSystemLike,
  home: string,
  config: ConnectorConfig,
): Promise<void> {
  await fs.mkdir(connectorConfigDir(home), { recursive: true });
  const path = connectorConfigPath(home);
  await fs.writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // Belt-and-braces on filesystems where writeFile mode is ignored (pre-existing file).
  if (fs.chmod) await fs.chmod(path, 0o600).catch(() => {});
}

export type LoadOrAdoptResult = {
  config: ConnectorConfig;
  /** True when this call migrated an ai-bridge.json pairing into connector.json. */
  adopted: boolean;
};

/**
 * Load connector.json; when absent, adopt a legacy ai-bridge.json pairing if one exists.
 * Adoption WRITES connector.json (so it only happens once) and leaves ai-bridge.json
 * untouched — the standalone bridge keeps working until the member retires it.
 */
export async function loadOrAdoptConnectorConfig(
  fs: FileSystemLike,
  home: string,
  now: () => number = Date.now,
): Promise<LoadOrAdoptResult | null> {
  const existing = await loadConnectorConfig(fs, home);
  if (existing) return { config: existing, adopted: false };

  const legacyRaw = await readIfExists(fs, legacyBridgeConfigPath(home));
  if (legacyRaw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(legacyRaw);
  } catch {
    return null;
  }
  const adopted = adoptLegacyBridgeConfig(parsed, new Date(now()).toISOString());
  if (!adopted) return null;
  await saveConnectorConfig(fs, home, adopted);
  return { config: adopted, adopted: true };
}
