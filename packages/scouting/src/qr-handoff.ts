/**
 * Scout QR handoff — embed small batches offline, or short-code when payload won't scan.
 * Short codes use the same ambiguous alphabet as CAD/editor pairing (no I/O/0/1).
 */

import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";
import { lockScoutPayload } from "./identity";

export const SCOUT_QR_EMBED_PREFIX = "vantage://scout/";
/**
 * Deflated JSON (raw DEFLATE, base64url). Scout payloads repeat the same keys
 * on every row, so a batch that was two entries per scan uncompressed fits
 * eight to twelve — the difference between "hand the tablet over" and "scan".
 */
export const SCOUT_QR_COMPRESSED_PREFIX = "vantage://scoutz/";
export const SCOUT_QR_HANDOFF_PREFIX = "vantage://handoff/";
export const SCOUT_QR_MAX_EMBEDDED_BYTES = 1200;

const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type ScoutQrRecord = {
  clientId: string;
  eventKey: string;
  matchKey?: string;
  teamKey: string;
  type?: "match" | "pit";
  schemaId?: string;
  payload: Record<string, unknown>;
  confidence?: "high" | "normal" | "low";
  source?: "manual" | "voice" | "import" | "video";
  updatedAt?: string;
};

export type ScoutQrDecode =
  | { kind: "embedded"; records: ScoutQrRecord[]; rawJson: string }
  | { kind: "handoff"; code: string }
  | { kind: "json"; records: ScoutQrRecord[]; rawJson: string };

function utf8ToBase64Url(text: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(text, "utf8").toString("base64url");
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64url");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(encoded: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(encoded, "base64url"));
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((encoded.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function base64UrlToUtf8(encoded: string): string {
  const cleaned = encoded.replace(/^vantage:\/\//, "").replace(/^scout\//, "");
  if (typeof Buffer !== "undefined") return Buffer.from(cleaned, "base64url").toString("utf8");
  const padded = cleaned.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((cleaned.length + 3) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function normalizeRecord(raw: unknown, index: number): ScoutQrRecord {
  if (!raw || typeof raw !== "object") throw new Error(`QR row ${index + 1} must be an object`);
  const row = raw as Record<string, unknown>;
  const eventKey = String(row.eventKey ?? row.event_key ?? row.event ?? "").trim();
  const matchKey = String(row.matchKey ?? row.match_key ?? row.match ?? "").trim() || undefined;
  const teamValue = String(row.teamKey ?? row.team_key ?? row.team ?? row.teamNumber ?? "").trim();
  const teamKey = /^frc\d+$/i.test(teamValue) ? teamValue.toLowerCase() : `frc${teamValue}`;
  if (!eventKey || !/^frc\d+$/.test(teamKey)) throw new Error(`QR row ${index + 1} lacks event/team identity`);
  const reserved = new Set([
    "clientId", "client_id", "eventKey", "event_key", "event", "matchKey", "match_key", "match",
    "teamKey", "team_key", "team", "teamNumber", "payload", "type", "schemaId", "schema_id",
    "confidence", "source", "updatedAt", "updated_at",
  ]);
  const rawPayload =
    row.payload && typeof row.payload === "object"
      ? (row.payload as Record<string, unknown>)
      : Object.fromEntries(Object.entries(row).filter(([key]) => !reserved.has(key)));
  // CD #4 — QR rows may carry legacy free-text scout names; strip before queue/sync.
  const payload = lockScoutPayload(rawPayload).payload;
  return {
    clientId: String(row.clientId ?? row.client_id ?? `qr-${index}-${eventKey}-${teamKey}`),
    eventKey,
    matchKey,
    teamKey,
    type: row.type === "pit" || row.type === "match" ? row.type : undefined,
    schemaId: row.schemaId || row.schema_id ? String(row.schemaId ?? row.schema_id) : undefined,
    payload,
    confidence:
      row.confidence === "high" || row.confidence === "normal" || row.confidence === "low"
        ? row.confidence
        : undefined,
    source:
      row.source === "manual" || row.source === "voice" || row.source === "import" || row.source === "video"
        ? row.source
        : undefined,
    updatedAt: row.updatedAt || row.updated_at ? String(row.updatedAt ?? row.updated_at) : undefined,
  };
}

function parseRecordsJson(json: string): ScoutQrRecord[] {
  const parsed = JSON.parse(json) as unknown;
  return (Array.isArray(parsed) ? parsed : [parsed]).map((raw, index) => normalizeRecord(raw, index));
}

export function scoutHandoffUserCode(randomByte: (max: number) => number = defaultRandomByte): string {
  const chars = Array.from({ length: 8 }, () => PAIRING_ALPHABET[randomByte(PAIRING_ALPHABET.length)]!);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

function defaultRandomByte(max: number): number {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const buf = new Uint8Array(1);
    crypto.getRandomValues(buf);
    return buf[0]! % max;
  }
  return Math.floor(Math.random() * max);
}

export function normalizeHandoffCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function formatHandoffCode(code: string): string {
  const compact = normalizeHandoffCode(code);
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
}

export function encodeScoutQrPayload(
  records: ScoutQrRecord[],
  options: { compress?: boolean } = {},
): string {
  if (!records.length) throw new Error("Nothing to encode for QR handoff");
  const json = JSON.stringify(records.length === 1 ? records[0] : records);
  const plain = `${SCOUT_QR_EMBED_PREFIX}${utf8ToBase64Url(json)}`;
  if (options.compress === false) return plain;
  const packed = `${SCOUT_QR_COMPRESSED_PREFIX}${bytesToBase64Url(deflateSync(strToU8(json), { level: 9 }))}`;
  // Tiny batches can grow under DEFLATE framing — keep whichever scans smaller.
  return packed.length < plain.length ? packed : plain;
}

export function encodeScoutHandoffQr(code: string, verificationUri?: string): string {
  if (verificationUri?.trim()) return verificationUri.trim();
  return `${SCOUT_QR_HANDOFF_PREFIX}${formatHandoffCode(code)}`;
}

export function embeddedQrByteLength(records: ScoutQrRecord[]): number {
  return new TextEncoder().encode(encodeScoutQrPayload(records)).length;
}

export function needsShortCodeHandoff(records: ScoutQrRecord[]): boolean {
  return records.length > 0 && embeddedQrByteLength(records) > SCOUT_QR_MAX_EMBEDDED_BYTES;
}

export function decodeScoutQrContent(content: string): ScoutQrDecode {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("Empty QR payload");

  const handoffMatch =
    trimmed.match(/^vantage:\/\/handoff\/([A-Za-z0-9-]{8,10})$/i) ||
    trimmed.match(/[?&](?:code|handoff)=([A-Za-z0-9-]{8,10})/i);
  if (handoffMatch?.[1] && normalizeHandoffCode(handoffMatch[1]).length === 8) {
    return { kind: "handoff", code: formatHandoffCode(handoffMatch[1]) };
  }
  if (/^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(trimmed) && normalizeHandoffCode(trimmed).length === 8) {
    return { kind: "handoff", code: formatHandoffCode(trimmed) };
  }
  if (trimmed.startsWith(SCOUT_QR_COMPRESSED_PREFIX)) {
    const rawJson = strFromU8(inflateSync(base64UrlToBytes(trimmed.slice(SCOUT_QR_COMPRESSED_PREFIX.length))));
    return { kind: "embedded", records: parseRecordsJson(rawJson), rawJson };
  }
  if (trimmed.startsWith(SCOUT_QR_EMBED_PREFIX)) {
    const rawJson = base64UrlToUtf8(trimmed.slice(SCOUT_QR_EMBED_PREFIX.length));
    return { kind: "embedded", records: parseRecordsJson(rawJson), rawJson };
  }
  if (trimmed.startsWith("vantage://")) {
    const withoutScheme = trimmed.slice("vantage://".length);
    const rawJson = base64UrlToUtf8(
      withoutScheme.startsWith("scout/") ? withoutScheme.slice("scout/".length) : withoutScheme,
    );
    return { kind: "embedded", records: parseRecordsJson(rawJson), rawJson };
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return { kind: "json", records: parseRecordsJson(trimmed), rawJson: trimmed };
  }
  try {
    const rawJson = base64UrlToUtf8(trimmed);
    if (rawJson.startsWith("{") || rawJson.startsWith("[")) {
      return { kind: "embedded", records: parseRecordsJson(rawJson), rawJson };
    }
  } catch {
    /* fall through */
  }
  throw new Error("Unrecognized scout QR payload");
}

export function qrContentToImportJson(content: string): string {
  const decoded = decodeScoutQrContent(content);
  if (decoded.kind === "handoff") {
    throw new Error(`Short-code handoff ${decoded.code} must be redeemed via /api/scouting/handoff`);
  }
  return decoded.rawJson;
}

export type OfflineMergeResult = {
  queued: import("./index").SyncEntry[];
  accepted: number;
  replaced: number;
  ignored: number;
};

export function syncEntriesToQrRecords(entries: import("./index").SyncEntry[]): ScoutQrRecord[] {
  return entries.map((entry) => ({
    clientId: entry.clientId,
    eventKey: entry.eventKey,
    matchKey: entry.matchKey,
    teamKey: entry.teamKey,
    type: entry.type,
    schemaId: entry.schemaId,
    payload: lockScoutPayload(entry.payload).payload,
    confidence: entry.confidence,
    source: entry.source,
    updatedAt: entry.updatedAt,
  }));
}

export function importedToSyncEntries(input: {
  records: ScoutQrRecord[];
  schemaId: string;
  type: "match" | "pit";
}): import("./index").SyncEntry[] {
  return input.records.map((record) => ({
    clientId: record.clientId,
    type: record.type ?? input.type,
    eventKey: record.eventKey,
    matchKey: record.matchKey,
    teamKey: record.teamKey,
    schemaId: record.schemaId ?? input.schemaId,
    payload: lockScoutPayload(record.payload).payload,
    confidence: record.confidence ?? "normal",
    // QR / short-code ingress is always provenance "import" on the receiving device.
    source: "import",
    updatedAt:
      record.updatedAt && Number.isFinite(Date.parse(record.updatedAt))
        ? record.updatedAt
        : new Date().toISOString(),
  }));
}

export function mergeOfflineHandoff(
  existing: import("./index").SyncEntry[],
  incoming: import("./index").SyncEntry[],
): OfflineMergeResult {
  const rows = new Map(existing.map((entry) => [entry.clientId, entry]));
  let accepted = 0;
  let replaced = 0;
  let ignored = 0;
  for (const entry of incoming) {
    const current = rows.get(entry.clientId);
    if (!current) {
      rows.set(entry.clientId, entry);
      accepted += 1;
    } else if (Date.parse(entry.updatedAt) > Date.parse(current.updatedAt)) {
      rows.set(entry.clientId, entry);
      replaced += 1;
    } else {
      ignored += 1;
    }
  }
  return {
    queued: [...rows.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
    accepted,
    replaced,
    ignored,
  };
}

export type CoverageDashboardCell = {
  matchKey: string;
  teamKey: string;
  assignmentCount: number;
  entryCount: number;
  pendingCount?: number;
  state?: "missing" | "assigned" | "covered" | "double_covered";
};

/** Overlay device-local QR/P2P rows onto server coverage before connectivity returns. */
export function applyPendingToCoverage(
  cells: CoverageDashboardCell[],
  pending: Array<Pick<import("./index").SyncEntry, "matchKey" | "teamKey">>,
): CoverageDashboardCell[] {
  const counts = new Map<string, number>();
  for (const entry of pending) {
    if (!entry.matchKey) continue;
    const key = `${entry.matchKey}|${entry.teamKey}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return cells.map((cell) => {
    const pendingCount = counts.get(`${cell.matchKey}|${cell.teamKey}`) ?? 0;
    const total = cell.entryCount + pendingCount;
    const state = total > 1 ? "double_covered" : total === 1 ? "covered" : cell.assignmentCount ? "assigned" : "missing";
    return { ...cell, pendingCount, state };
  });
}

export function summarizeCoverage(cells: CoverageDashboardCell[]) {
  return cells.reduce(
    (summary, cell) => {
      const state =
        cell.state ??
        (cell.entryCount > 1
          ? "double_covered"
          : cell.entryCount === 1
            ? "covered"
            : cell.assignmentCount
              ? "assigned"
              : "missing");
      summary[state] += 1;
      summary.total += 1;
      if ((cell.pendingCount ?? 0) > 0) summary.pendingRows += 1;
      return summary;
    },
    { total: 0, missing: 0, assigned: 0, covered: 0, double_covered: 0, pendingRows: 0 },
  );
}
