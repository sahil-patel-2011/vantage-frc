// Self-hosted storage node — shared pure helpers (client-safe: no node imports here).
//
// Liveness is DERIVED from last_heartbeat_at, never read from a status column: the node
// heartbeats every 60s, so a gap over 5 minutes means degraded and over 30 minutes offline.
// Nothing here fabricates availability — "never" is a real state shown as such.

export const HEARTBEAT_INTERVAL_SECONDS = 60;
export const DEGRADED_AFTER_MS = 5 * 60 * 1000;
export const OFFLINE_AFTER_MS = 30 * 60 * 1000;

export type NodeLiveness = "online" | "degraded" | "offline" | "never";

export function nodeLiveness(lastHeartbeatAt: string | null, nowMs: number): NodeLiveness {
  if (!lastHeartbeatAt) return "never";
  const beat = Date.parse(lastHeartbeatAt);
  if (!Number.isFinite(beat)) return "never";
  const gap = nowMs - beat;
  if (gap > OFFLINE_AFTER_MS) return "offline";
  if (gap > DEGRADED_AFTER_MS) return "degraded";
  return "online";
}

export const LIVENESS_LABEL: Record<NodeLiveness, string> = {
  online: "Online",
  degraded: "Degraded — no heartbeat for over 5 minutes",
  offline: "Offline",
  never: "Never seen — the node has not sent its first heartbeat",
};

export function formatBytes(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

export const SHA256_RE = /^[0-9a-f]{64}$/;

export function isValidSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_RE.test(value);
}

/** Validate a team-entered base URL for a node: http(s), no query/hash, trailing slash dropped. */
export function normalizeBaseUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.search || url.hash || url.username || url.password) return null;
  return `${url.origin}${url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "")}`;
}
