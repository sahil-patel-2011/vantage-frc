// Pure, framework-free inspection-readiness prediction math. Everything here is deterministic
// and grounded only in the weight budget, frame/bumper, and wiring/power limits + measurements
// the caller supplies — it never fabricates a rule number or a measurement.
// compute-inspection-copilot.ts wraps this with DB I/O; the API route and client render results.

import type {
  FrameBumperSpec,
  InspectionFlag,
  InspectionFlagSeverity,
  InspectionPrediction,
  WeightBudgetSpec,
  WiringPowerSpec,
} from "./types";

/** A weight within this fraction of the limit is flagged as a near-miss risk. */
export const WEIGHT_NEAR_LIMIT_MARGIN = 0.95;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export function inspectionFlagSeverityLabel(severity: InspectionFlagSeverity): string {
  switch (severity) {
    case "critical":
      return "Critical";
    case "warning":
      return "Warning";
    default:
      return "Info";
  }
}

const SEVERITY_WEIGHT: Record<InspectionFlagSeverity, number> = {
  critical: 1,
  warning: 0.4,
  info: 0.1,
};

export function totalDeclaredWeightLbs(budget: WeightBudgetSpec): number {
  return round(
    budget.items.reduce((sum, item) => sum + (Number.isFinite(item.weightLbs) ? item.weightLbs : 0), 0),
    2,
  );
}

/**
 * Compare the declared weight budget, frame/bumper limits, and wiring/power limits (from the
 * manual) against the measured/installed robot state to predict likely inspection failures.
 */
export function predictInspectionFailures(input: {
  weightBudget: WeightBudgetSpec;
  frameBumper: FrameBumperSpec;
  wiringPower: WiringPowerSpec;
}): InspectionPrediction {
  const flags: InspectionFlag[] = [];
  const { weightBudget, frameBumper, wiringPower } = input;
  const totalWeightLbs = totalDeclaredWeightLbs(weightBudget);

  if (weightBudget.limitLbs > 0) {
    if (totalWeightLbs > weightBudget.limitLbs) {
      flags.push({
        type: "weight_over_limit",
        severity: "critical",
        message: `Itemized weight ${totalWeightLbs} lbs exceeds the ${weightBudget.limitLbs} lbs limit — this robot will not pass weigh-in as configured.`,
      });
    } else if (totalWeightLbs >= weightBudget.limitLbs * WEIGHT_NEAR_LIMIT_MARGIN) {
      flags.push({
        type: "weight_near_limit",
        severity: "warning",
        message: `Itemized weight ${totalWeightLbs} lbs is within ${Math.round(
          (1 - WEIGHT_NEAR_LIMIT_MARGIN) * 100,
        )}% of the ${weightBudget.limitLbs} lbs limit — little margin for field-added mass (game pieces, paint, fasteners).`,
      });
    }
  }

  if (frameBumper.perimeterLimitIn > 0 && frameBumper.measuredPerimeterIn > frameBumper.perimeterLimitIn) {
    flags.push({
      type: "frame_perimeter_exceeded",
      severity: "critical",
      message: `Measured frame perimeter ${frameBumper.measuredPerimeterIn} in exceeds the ${frameBumper.perimeterLimitIn} in limit.`,
    });
  }

  if (frameBumper.bumperMaxHeightIn > 0 || frameBumper.bumperMinHeightIn > 0) {
    if (
      frameBumper.measuredBumperMinHeightIn < frameBumper.bumperMinHeightIn ||
      frameBumper.measuredBumperMaxHeightIn > frameBumper.bumperMaxHeightIn
    ) {
      flags.push({
        type: "bumper_height_out_of_range",
        severity: "critical",
        message: `Measured bumper coverage ${frameBumper.measuredBumperMinHeightIn}–${frameBumper.measuredBumperMaxHeightIn} in falls outside the required ${frameBumper.bumperMinHeightIn}–${frameBumper.bumperMaxHeightIn} in range.`,
      });
    }
  }

  if (
    frameBumper.bumperMinThicknessIn > 0 &&
    frameBumper.measuredBumperThicknessIn < frameBumper.bumperMinThicknessIn
  ) {
    flags.push({
      type: "bumper_undersized_thickness",
      severity: "critical",
      message: `Measured bumper thickness ${frameBumper.measuredBumperThicknessIn} in is below the ${frameBumper.bumperMinThicknessIn} in minimum.`,
    });
  }

  if (
    wiringPower.mainBreakerMaxAmps > 0 &&
    wiringPower.installedMainBreakerAmps > wiringPower.mainBreakerMaxAmps
  ) {
    flags.push({
      type: "main_breaker_oversized",
      severity: "critical",
      message: `Installed main breaker ${wiringPower.installedMainBreakerAmps}A exceeds the ${wiringPower.mainBreakerMaxAmps}A maximum allowed.`,
    });
  }

  if (!wiringPower.batterySecured) {
    flags.push({
      type: "battery_not_secured",
      severity: "critical",
      message: "Battery is not marked as mechanically secured — inspectors check for a secure, non-conductive strap/bracket.",
    });
  }

  if (!wiringPower.wiresLabeled) {
    flags.push({
      type: "wires_unlabeled",
      severity: "warning",
      message: "Wiring is not marked as labeled — unlabeled circuits slow inspection and risk a fail-and-return.",
    });
  }

  if (!wiringPower.radioPowerOk) {
    flags.push({
      type: "radio_power_fault",
      severity: "critical",
      message: "Radio power path is not marked as compliant — verify the radio is powered per the approved wiring diagram.",
    });
  }

  if (!wiringPower.bypassSwitchAccessible) {
    flags.push({
      type: "bypass_switch_inaccessible",
      severity: "warning",
      message: "Main breaker/bypass is not marked as accessible from outside the frame perimeter.",
    });
  }

  const checkCount =
    (weightBudget.limitLbs > 0 ? 1 : 0) +
    (frameBumper.perimeterLimitIn > 0 ? 1 : 0) +
    (frameBumper.bumperMaxHeightIn > 0 || frameBumper.bumperMinHeightIn > 0 ? 1 : 0) +
    (frameBumper.bumperMinThicknessIn > 0 ? 1 : 0) +
    5; // wiring/power checks are always evaluated
  const weighted = flags.reduce((sum, flag) => sum + SEVERITY_WEIGHT[flag.severity], 0);
  const riskScore = round(clamp01(weighted / Math.max(1, checkCount)));

  const criticalCount = flags.filter((flag) => flag.severity === "critical").length;
  const warningCount = flags.filter((flag) => flag.severity === "warning").length;
  const summary =
    flags.length === 0
      ? `No predicted inspection failures across weight, frame/bumper, and wiring/power checks.`
      : `${criticalCount} critical and ${warningCount} warning issue(s) predicted — resolve critical items before you travel.`;

  return { flags, riskScore, totalWeightLbs, summary };
}
