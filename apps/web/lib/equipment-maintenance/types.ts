// Equipment maintenance domain types. Pure data shapes — no I/O, no framework imports.
// Tracks the shop's durable equipment (mills, printers, saws, ...), a recurring maintenance
// interval per asset, and the log of maintenance actions actually performed.

export type EquipmentCategory =
  | "cnc"
  | "mill"
  | "lathe"
  | "drill_press"
  | "saw"
  | "printer_3d"
  | "laser"
  | "welder"
  | "hand_tool"
  | "safety"
  | "other";

export type MaintenanceAction = "routine" | "repair" | "inspection" | "calibration" | "cleaning" | "other";

export type EquipmentAsset = {
  id: string;
  name: string;
  category: EquipmentCategory;
  location: string | null;
  /** Recurring maintenance cadence, in days. Null = no schedule tracked. */
  intervalDays: number | null;
  notes: string | null;
  active: boolean;
};

export type MaintenanceLog = {
  id: string;
  assetId: string;
  performedOn: string;
  action: MaintenanceAction;
  minutesSpent: number;
  notes: string | null;
};

export type EquipmentStatus = "overdue" | "due_soon" | "ok" | "unscheduled";

export type EquipmentAssetView = EquipmentAsset & {
  lastPerformedOn: string | null;
  nextDueOn: string | null;
  daysUntilDue: number | null;
  status: EquipmentStatus;
  logCount: number;
};

export type EquipmentSummary = {
  totalAssets: number;
  activeAssets: number;
  overdueCount: number;
  dueSoonCount: number;
  unscheduledCount: number;
  totalLogs: number;
  totalMinutesLogged: number;
  byCategory: Array<{ category: EquipmentCategory; assets: number; overdue: number }>;
};
