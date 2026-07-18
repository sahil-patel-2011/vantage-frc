// Scout P2P Relay domain types. Pure data shapes — no I/O, no framework imports.
// Device-to-device sync (BroadcastChannel/WebRTC) happens entirely client-side, in the pit,
// between tablets on the same local network. These types describe the server-side ledger of
// relay sessions and per-device merge contributions once the captain tablet aggregates local
// scout entries and uplinks the merged batch back to Vantage.

export type RelaySessionStatus = "open" | "synced" | "closed";

export type RelayDeviceRole = "scout" | "captain";

export type RelayEntry = {
  id: string;
  sessionId: string;
  deviceLabel: string;
  deviceRole: RelayDeviceRole;
  entriesContributed: number;
  conflictsResolved: number;
  uplinked: boolean;
  mergedAt: string;
};

export type RelaySession = {
  id: string;
  eventKey: string;
  seasonYear: number;
  captainDeviceLabel: string;
  status: RelaySessionStatus;
  startedAt: string;
  closedAt: string | null;
  /** Distinct devices that have logged a merge contribution to this session. */
  deviceCount: number;
  entriesMerged: number;
  conflictsResolved: number;
  /** Fraction (0..1) of merge contributions that have been uplinked to the server. */
  uplinkRate: number;
};

export type RelaySummary = {
  totalSessions: number;
  openSessions: number;
  syncedSessions: number;
  closedSessions: number;
  totalDevices: number;
  totalEntriesMerged: number;
  totalConflictsResolved: number;
  /** Fraction (0..1) of all merge contributions across sessions that have been uplinked. */
  uplinkRate: number;
};
