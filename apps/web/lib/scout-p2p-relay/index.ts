// Pure, unit-testable helpers for the Scout P2P Relay feature. No I/O here.

import type { RelayDeviceRole, RelayEntry, RelaySession, RelaySessionStatus, RelaySummary } from "./types";

export * from "./types";

export function relaySessionStatusLabel(status: RelaySessionStatus): string {
  switch (status) {
    case "open":
      return "Open — syncing in pit";
    case "synced":
      return "Synced — pending uplink";
    case "closed":
      return "Closed — uplinked";
    default:
      return status;
  }
}

export function relayDeviceRoleLabel(role: RelayDeviceRole): string {
  return role === "captain" ? "Captain tablet" : "Scout tablet";
}

/**
 * Rolls raw per-device merge-entry rows up into a session-level aggregate: distinct device
 * count, total entries merged, conflicts resolved by local peer merge, and uplink rate.
 */
export function summarizeSessionEntries(entries: RelayEntry[]): {
  deviceCount: number;
  entriesMerged: number;
  conflictsResolved: number;
  uplinkRate: number;
} {
  const devices = new Set(entries.map((entry) => entry.deviceLabel));
  const entriesMerged = entries.reduce((sum, entry) => sum + entry.entriesContributed, 0);
  const conflictsResolved = entries.reduce((sum, entry) => sum + entry.conflictsResolved, 0);
  const uplinked = entries
    .filter((entry) => entry.uplinked)
    .reduce((sum, entry) => sum + entry.entriesContributed, 0);
  return {
    deviceCount: devices.size,
    entriesMerged,
    conflictsResolved,
    uplinkRate: entriesMerged > 0 ? uplinked / entriesMerged : 0,
  };
}

/** Summarizes relay sessions (already aggregated with their entry rollups) into a dashboard summary. */
export function summarizeRelay(sessions: RelaySession[]): RelaySummary {
  const totalSessions = sessions.length;
  const openSessions = sessions.filter((s) => s.status === "open").length;
  const syncedSessions = sessions.filter((s) => s.status === "synced").length;
  const closedSessions = sessions.filter((s) => s.status === "closed").length;
  const totalDevices = sessions.reduce((sum, s) => sum + s.deviceCount, 0);
  const totalEntriesMerged = sessions.reduce((sum, s) => sum + s.entriesMerged, 0);
  const totalConflictsResolved = sessions.reduce((sum, s) => sum + s.conflictsResolved, 0);
  const uplinkedEntries = sessions.reduce((sum, s) => sum + s.entriesMerged * s.uplinkRate, 0);

  return {
    totalSessions,
    openSessions,
    syncedSessions,
    closedSessions,
    totalDevices,
    totalEntriesMerged,
    totalConflictsResolved,
    uplinkRate: totalEntriesMerged > 0 ? uplinkedEntries / totalEntriesMerged : 0,
  };
}

export {
  envelopeBelongsToSession,
  isP2pEnvelope,
  mergeP2pRecords,
  parseP2pEnvelope,
  p2pChannelName,
  p2pMergeLedgerCounts,
  P2P_ENVELOPE_VERSION,
  type ScoutP2pEnvelope,
} from "./pit-mesh";

