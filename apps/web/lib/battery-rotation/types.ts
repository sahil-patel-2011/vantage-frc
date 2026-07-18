// Battery rotation & charge planner domain types. Pure data shapes -- no I/O, no framework imports.
// Tracks internal-resistance (IR) trend per battery pack and the match-by-match rotation schedule,
// flagging "short pack" batteries and charge-time shortfalls before they hit the field.

export type BatteryStatus = "active" | "charging" | "short_pack" | "retired";

export type BatteryRecord = {
  id: string;
  label: string;
  serialNumber: string | null;
  status: BatteryStatus;
  purchasedOn: string | null;
  notes: string | null;
  createdAt: string;
};

export type BatteryReading = {
  id: string;
  batteryId: string;
  recordedAt: string;
  internalResistanceMohm: number;
  voltage: number | null;
  cycleCount: number | null;
  notes: string | null;
};

export type IrTrend = "improving" | "stable" | "worsening" | "unknown";

export type BatteryHealth = {
  batteryId: string;
  label: string;
  status: BatteryStatus;
  readingsCount: number;
  latestIrMohm: number | null;
  latestReadingAt: string | null;
  averageIrMohm: number | null;
  trend: IrTrend;
  /** True when the latest reading crosses the short-pack IR threshold. */
  shortPackAlert: boolean;
};

export type MatchAssignment = {
  id: string;
  batteryId: string;
  batteryLabel: string;
  matchLabel: string;
  scheduledAt: string;
  chargeMinutesAvailable: number;
};

export type RotationSlot = {
  assignmentId: string;
  matchLabel: string;
  scheduledAt: string;
  batteryId: string;
  batteryLabel: string;
  chargeMinutesAvailable: number;
  /** False when charge time before this match falls short of the recommended full-charge window. */
  chargeSufficient: boolean;
  /** True when the assigned battery itself carries a short-pack IR alert. */
  batteryAlert: boolean;
  batteryTrend: IrTrend;
};

export type RotationSummary = {
  totalBatteries: number;
  activeBatteries: number;
  shortPackCount: number;
  upcomingAssignments: number;
  chargeShortfallCount: number;
  /** 0..1 blend of fleet health and charge-plan feasibility for the scheduled window. */
  planReadiness: number;
};
