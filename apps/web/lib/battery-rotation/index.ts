// Pure, unit-testable battery-rotation math: IR trend classification, short-pack alerting, and
// rotation-plan feasibility. No I/O -- callers supply already-fetched rows.

import type {
  BatteryHealth,
  BatteryReading,
  BatteryRecord,
  BatteryStatus,
  IrTrend,
  MatchAssignment,
  RotationSlot,
  RotationSummary,
} from "./types";

export * from "./types";

/** Internal-resistance threshold (mOhm) above which a pack is flagged as a short pack. */
export const SHORT_PACK_IR_THRESHOLD_MOHM = 20;

/** Recommended full-charge window (minutes) a pack needs between matches to return to peak. */
export const RECOMMENDED_CHARGE_MINUTES = 90;

/** Fraction increase in average IR (vs. earliest reading) that counts as "worsening". */
const TREND_WORSEN_RATIO = 1.08;
const TREND_IMPROVE_RATIO = 0.92;

export function batteryStatusLabel(status: BatteryStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "charging":
      return "Charging";
    case "short_pack":
      return "Short pack";
    case "retired":
      return "Retired";
    default:
      return status;
  }
}

export function irTrendLabel(trend: IrTrend): string {
  switch (trend) {
    case "improving":
      return "Improving";
    case "worsening":
      return "Worsening";
    case "stable":
      return "Stable";
    default:
      return "Unknown";
  }
}

/**
 * Classifies a battery's IR trend from its readings (any order accepted; sorted internally by
 * recordedAt ascending). Compares the earliest reading in the window against the latest to
 * detect drift, alongside a flat short-pack threshold check on the latest reading.
 */
export function computeBatteryHealth(
  battery: Pick<BatteryRecord, "id" | "label" | "status">,
  readings: BatteryReading[],
): BatteryHealth {
  const sorted = [...readings]
    .filter((r) => r.batteryId === battery.id)
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

  if (sorted.length === 0) {
    return {
      batteryId: battery.id,
      label: battery.label,
      status: battery.status,
      readingsCount: 0,
      latestIrMohm: null,
      latestReadingAt: null,
      averageIrMohm: null,
      trend: "unknown",
      shortPackAlert: battery.status === "short_pack",
    };
  }

  const latest = sorted[sorted.length - 1]!;
  const earliest = sorted[0]!;
  const average =
    sorted.reduce((sum, r) => sum + r.internalResistanceMohm, 0) / sorted.length;

  let trend: IrTrend = "stable";
  if (sorted.length >= 2 && earliest.internalResistanceMohm > 0) {
    const ratio = latest.internalResistanceMohm / earliest.internalResistanceMohm;
    if (ratio >= TREND_WORSEN_RATIO) trend = "worsening";
    else if (ratio <= TREND_IMPROVE_RATIO) trend = "improving";
  } else {
    trend = "unknown";
  }

  const shortPackAlert =
    battery.status === "short_pack" || latest.internalResistanceMohm >= SHORT_PACK_IR_THRESHOLD_MOHM;

  return {
    batteryId: battery.id,
    label: battery.label,
    status: battery.status,
    readingsCount: sorted.length,
    latestIrMohm: latest.internalResistanceMohm,
    latestReadingAt: latest.recordedAt,
    averageIrMohm: Math.round(average * 100) / 100,
    trend,
    shortPackAlert,
  };
}

/** Builds the ordered rotation schedule, annotating each slot with health + charge feasibility. */
export function buildRotationSlots(
  assignments: MatchAssignment[],
  healthByBatteryId: Map<string, BatteryHealth>,
): RotationSlot[] {
  return [...assignments]
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    .map((assignment) => {
      const health = healthByBatteryId.get(assignment.batteryId);
      return {
        assignmentId: assignment.id,
        matchLabel: assignment.matchLabel,
        scheduledAt: assignment.scheduledAt,
        batteryId: assignment.batteryId,
        batteryLabel: assignment.batteryLabel,
        chargeMinutesAvailable: assignment.chargeMinutesAvailable,
        chargeSufficient: assignment.chargeMinutesAvailable >= RECOMMENDED_CHARGE_MINUTES,
        batteryAlert: health?.shortPackAlert ?? false,
        batteryTrend: health?.trend ?? "unknown",
      };
    });
}

export function summarizeRotation(
  batteries: BatteryHealth[],
  slots: RotationSlot[],
): RotationSummary {
  const totalBatteries = batteries.length;
  const activeBatteries = batteries.filter((b) => b.status === "active" || b.status === "charging").length;
  const shortPackCount = batteries.filter((b) => b.shortPackAlert).length;
  const upcomingAssignments = slots.length;
  const chargeShortfallCount = slots.filter((s) => !s.chargeSufficient).length;

  const healthScore = totalBatteries > 0 ? 1 - shortPackCount / totalBatteries : 0;
  const feasibilityScore = upcomingAssignments > 0 ? 1 - chargeShortfallCount / upcomingAssignments : 0;
  const planReadiness =
    totalBatteries === 0
      ? 0
      : Math.round(Math.max(0, Math.min(1, healthScore * 0.6 + feasibilityScore * 0.4)) * 100) / 100;

  return {
    totalBatteries,
    activeBatteries,
    shortPackCount,
    upcomingAssignments,
    chargeShortfallCount,
    planReadiness,
  };
}
