// Pure helper functions for Equipment Maintenance — no I/O, unit-testable in isolation.

import type {
  EquipmentAsset,
  EquipmentAssetView,
  EquipmentCategory,
  EquipmentStatus,
  EquipmentSummary,
  MaintenanceLog,
} from "./types";

const DUE_SOON_WINDOW_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function equipmentCategoryLabel(category: EquipmentCategory): string {
  switch (category) {
    case "cnc":
      return "CNC";
    case "mill":
      return "Mill";
    case "lathe":
      return "Lathe";
    case "drill_press":
      return "Drill press";
    case "saw":
      return "Saw";
    case "printer_3d":
      return "3D printer";
    case "laser":
      return "Laser cutter";
    case "welder":
      return "Welder";
    case "hand_tool":
      return "Hand tool";
    case "safety":
      return "Safety equipment";
    default:
      return "Other";
  }
}

export function maintenanceActionLabel(action: MaintenanceLog["action"]): string {
  switch (action) {
    case "routine":
      return "Routine maintenance";
    case "repair":
      return "Repair";
    case "inspection":
      return "Inspection";
    case "calibration":
      return "Calibration";
    case "cleaning":
      return "Cleaning";
    default:
      return "Other";
  }
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / MS_PER_DAY);
}

function addDays(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`) + days * MS_PER_DAY;
  return new Date(ms).toISOString().slice(0, 10);
}

export function computeAssetStatus(
  intervalDays: number | null,
  nextDueOn: string | null,
  todayIso: string,
): EquipmentStatus {
  if (!intervalDays || !nextDueOn) return "unscheduled";
  const daysUntil = daysBetween(todayIso, nextDueOn);
  if (daysUntil < 0) return "overdue";
  if (daysUntil <= DUE_SOON_WINDOW_DAYS) return "due_soon";
  return "ok";
}

/** Builds the per-asset schedule view from an asset and its logs (most-recent-first not required). */
export function buildAssetView(
  asset: EquipmentAsset,
  logs: MaintenanceLog[],
  todayIso: string,
): EquipmentAssetView {
  const assetLogs = logs.filter((log) => log.assetId === asset.id);
  const sorted = [...assetLogs].sort((a, b) => (a.performedOn < b.performedOn ? 1 : -1));
  const lastPerformedOn = sorted[0]?.performedOn ?? null;

  let nextDueOn: string | null = null;
  if (asset.intervalDays) {
    nextDueOn = lastPerformedOn ? addDays(lastPerformedOn, asset.intervalDays) : todayIso;
  }

  const status = computeAssetStatus(asset.intervalDays, nextDueOn, todayIso);
  const daysUntilDue = nextDueOn ? daysBetween(todayIso, nextDueOn) : null;

  return {
    ...asset,
    lastPerformedOn,
    nextDueOn,
    daysUntilDue,
    status,
    logCount: assetLogs.length,
  };
}

export function summarizeEquipment(assetViews: EquipmentAssetView[], logs: MaintenanceLog[]): EquipmentSummary {
  const activeViews = assetViews.filter((a) => a.active);
  const byCategoryMap = new Map<EquipmentCategory, { assets: number; overdue: number }>();
  for (const view of assetViews) {
    const bucket = byCategoryMap.get(view.category) ?? { assets: 0, overdue: 0 };
    bucket.assets += 1;
    if (view.status === "overdue") bucket.overdue += 1;
    byCategoryMap.set(view.category, bucket);
  }
  const byCategory = Array.from(byCategoryMap.entries())
    .map(([category, v]) => ({ category, assets: v.assets, overdue: v.overdue }))
    .sort((a, b) => b.assets - a.assets);

  return {
    totalAssets: assetViews.length,
    activeAssets: activeViews.length,
    overdueCount: activeViews.filter((a) => a.status === "overdue").length,
    dueSoonCount: activeViews.filter((a) => a.status === "due_soon").length,
    unscheduledCount: activeViews.filter((a) => a.status === "unscheduled").length,
    totalLogs: logs.length,
    totalMinutesLogged: logs.reduce((sum, log) => sum + log.minutesSpent, 0),
    byCategory,
  };
}
