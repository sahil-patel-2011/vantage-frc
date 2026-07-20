// CAD Change Impact Radar domain types. Pure data shapes — no I/O, no framework imports. A
// "snapshot" is the tracked-parameter state (envelope dims, mount hole patterns, mass, gear
// ratios) of one Onshape part at one release revision. A "diff" is the delta between two
// snapshots of the same part, severity-scored. A "subscription" ties a member to a part-key
// (or subsystem) so they get fanned-out notifications when that part changes.

export type CadChangeRadarSeverity = "minor" | "moderate" | "major";

/** A single tracked-parameter delta between two revisions. */
export type CadChangeRadarParamDelta = {
  key: string;
  fromValue: number | string | null;
  toValue: number | string | null;
  percentChange: number | null;
};

/** Tracked-parameter snapshot of one part at one release revision. */
export type CadChangeRadarSnapshot = {
  id: string;
  partKey: string;
  partName: string;
  revision: string;
  params: Record<string, number | string>;
  massKg: number | null;
  capturedAt: string;
};

/** A diff between two consecutive snapshots of a part. */
export type CadChangeRadarDiff = {
  id: string;
  partKey: string;
  partName: string;
  fromRevision: string | null;
  toRevision: string;
  changedParams: CadChangeRadarParamDelta[];
  severity: CadChangeRadarSeverity;
  aiSummary: string | null;
  createdAt: string;
};

/** A member's subscription to change alerts for a given part key. */
export type CadChangeRadarSubscription = {
  id: string;
  userId: string;
  userName: string | null;
  partKey: string;
  subsystem: string | null;
  createdAt: string;
};

/** A fanned-out notification tied to a diff, addressed to a subscriber. */
export type CadChangeRadarNotification = {
  id: string;
  diffId: string;
  partKey: string;
  partName: string;
  message: string;
  severity: CadChangeRadarSeverity;
  acknowledgedAt: string | null;
  createdAt: string;
};

export type CadChangeRadarConnection = {
  id: string;
  label: string;
  status: string;
};
