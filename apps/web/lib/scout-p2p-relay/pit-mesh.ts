// Pure pit-mesh helpers for BroadcastChannel / paste envelopes. No IndexedDB here.

import type { SyncEntry } from "@vantage/scouting";
import {
  importedToSyncEntries,
  mergeOfflineHandoff,
  type OfflineMergeResult,
  type ScoutQrRecord,
} from "@vantage/scouting/qr-handoff";
import type { RelayDeviceRole } from "./types";

export const P2P_ENVELOPE_VERSION = 1 as const;

export type ScoutP2pEnvelope = {
  v: typeof P2P_ENVELOPE_VERSION;
  orgId: string;
  sessionId: string;
  deviceId: string;
  deviceLabel: string;
  deviceRole: RelayDeviceRole;
  records: ScoutQrRecord[];
  sentAt: string;
};

export function p2pChannelName(orgId: string, sessionId: string): string {
  return `vantage-scout-p2p:${orgId}:${sessionId}`;
}

export function isP2pEnvelope(value: unknown): value is ScoutP2pEnvelope {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (row.v !== P2P_ENVELOPE_VERSION) return false;
  if (typeof row.orgId !== "string" || !row.orgId.trim()) return false;
  if (typeof row.sessionId !== "string" || !row.sessionId.trim()) return false;
  if (typeof row.deviceId !== "string" || !row.deviceId.trim()) return false;
  if (typeof row.deviceLabel !== "string" || !row.deviceLabel.trim()) return false;
  if (row.deviceRole !== "scout" && row.deviceRole !== "captain") return false;
  if (!Array.isArray(row.records)) return false;
  if (typeof row.sentAt !== "string") return false;
  return true;
}

export function parseP2pEnvelope(raw: string): ScoutP2pEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isP2pEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function envelopeBelongsToSession(
  envelope: ScoutP2pEnvelope,
  input: { orgId: string; sessionId: string },
): boolean {
  return envelope.orgId === input.orgId && envelope.sessionId === input.sessionId;
}

/** Last-write-wins merge of peer QR records into this device's outbox snapshot. */
export function mergeP2pRecords(
  existing: SyncEntry[],
  records: ScoutQrRecord[],
): OfflineMergeResult {
  if (!records.length) {
    return { queued: existing, accepted: 0, replaced: 0, ignored: 0 };
  }
  const incoming = importedToSyncEntries({
    records,
    schemaId: records[0]?.schemaId ?? "p2p",
    type: records[0]?.type === "pit" ? "pit" : "match",
  });
  return mergeOfflineHandoff(existing, incoming);
}

export function p2pMergeLedgerCounts(result: OfflineMergeResult): {
  entriesContributed: number;
  conflictsResolved: number;
} {
  return {
    entriesContributed: result.accepted + result.replaced,
    conflictsResolved: result.replaced,
  };
}
