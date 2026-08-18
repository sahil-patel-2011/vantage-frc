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

  if (frameBumper.bumperEventRecorded) {
    if (!frameBumper.solidCoreFoam) {
      flags.push({
        type: "bumper_hollow_foam",
        severity: "critical",
        message:
          "Bumper padding is not marked solid-core — hollow pool noodles are illegal and are the usual last-minute inspection fail.",
      });
    }
    if (!frameBumper.separateColorSets) {
      flags.push({
        type: "bumper_reversible",
        severity: "warning",
        message:
          "Bumpers are not marked as separate red and blue sets — reversible fabric keeps failing and eats the weight you wanted for armor.",
      });
    }
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

  if (wiringPower.binderRecorded) {
    if (!wiringPower.bomPrinted) {
      flags.push({
        type: "bom_not_printed",
        severity: "critical",
        message:
          "Printed Bill of Materials is not marked packed — inspectors require a real BOM (part, qty, price, supplier) at every event, not a napkin list.",
      });
    }
    if (!wiringPower.inspectionChecklistPrinted) {
      flags.push({
        type: "inspection_checklist_not_printed",
        severity: "warning",
        message: "Printed robot inspection checklist is not marked packed — walk it with a student before Thursday.",
      });
    }
    if (!wiringPower.studentCaptainPresent) {
      flags.push({
        type: "student_captain_absent",
        severity: "warning",
        message: "No student team captain is marked present to sign inspection — inspectors talk to students, not only mentors.",
      });
    }
  }

  if (wiringPower.radioEventRecorded) {
    if (!wiringPower.radioOnMainPd) {
      flags.push({
        type: "radio_not_on_main_pd",
        severity: "critical",
        message:
          "Radio is not marked powered from the main PD — 2026 inspectors fail VH-109 radios on a VRM/RPM or Mini PD; use 12V from the PD and/or a passive PoE injector.",
      });
    }
    if (!wiringPower.rioOnMainPd10A) {
      flags.push({
        type: "rio_not_on_main_pd",
        severity: "critical",
        message:
          "roboRIO is not marked on a non-switched 10A PD branch — do not power the RIO from a Mini PD or extra fuse block.",
      });
    }
    if (!wiringPower.radioProgrammedForEvent) {
      flags.push({
        type: "radio_not_programmed_for_event",
        severity: "warning",
        message:
          "Radio is not marked programmed for this event — inspectors require event programming before inspection.",
      });
    }
    if (!wiringPower.radioWeidmullerQc) {
      flags.push({
        type: "radio_weidmuller_strands",
        severity: "warning",
        message:
          "VH-109 Weidmuller power leads are not marked second-person QC — stray strands or long strip length reboot the radio mid-match.",
      });
    }
  }

  if (wiringPower.sparkMaxEventRecorded && !wiringPower.sparkMaxUsbAvoided) {
    flags.push({
      type: "spark_max_usb_risk",
      severity: "critical",
      message:
        "Spark MAX USB-C is not marked avoided on a suspect controller — a shorted phase can back-feed through USB and fry the laptop motherboard. Diagnose via CAN, not USB.",
    });
  }

  if (wiringPower.reliabilityEventRecorded) {
    if (!wiringPower.strainReliefOk) {
      flags.push({
        type: "strain_relief_missing",
        severity: "warning",
        message:
          "Strain relief is not marked on every connection — if a wire can be tugged loose, it will come loose on the field.",
      });
    }
    if (!wiringPower.dynamicCableClear) {
      flags.push({
        type: "dynamic_cable_pinch",
        severity: "warning",
        message:
          "Dynamic cable runs are not marked clear of pinch — CAN/signal/power in igus or near rotating mechanisms dropped robots mid-match.",
      });
    }
    if (!wiringPower.esdIntakeBonded) {
      flags.push({
        type: "esd_intake_unbonded",
        severity: "warning",
        message:
          "Intake is not marked chassis-bonded (not to power) — static from game pieces is real, but wiring and loose connections are the usual cause.",
      });
    }
    if (!wiringPower.esdShielded) {
      flags.push({
        type: "esd_unshielded",
        severity: "info",
        message:
          "Sensitive electronics are not marked foil/copper wrapped — gyro resets show up next to foam game pieces.",
      });
    }
    if (!wiringPower.canivorePdhBackup) {
      flags.push({
        type: "canivore_no_pdh_backup",
        severity: "warning",
        message:
          "CANivore is not marked with a PDH power backup — a USB dropout kills all RIO USB ports and the rest of CAN with it.",
      });
    }
    if (!wiringPower.batteryLeadsTorqued) {
      flags.push({
        type: "battery_leads_loose",
        severity: "warning",
        message:
          "Battery / main breaker / PD lead bolts are not marked torqued — loose leads add resistance and look like a dying pack.",
      });
    }
    if (!wiringPower.mainBreakerCovered) {
      flags.push({
        type: "main_breaker_exposed",
        severity: "warning",
        message:
          "Main breaker is not marked covered — exposed electronics take field hits; pack a printed cover.",
      });
    }
    if (!wiringPower.rioUsbCameraClear) {
      flags.push({
        type: "rio_usb_camera_canivore",
        severity: "warning",
        message:
          "RIO USB cameras are not marked off the ports next to a CANivore — ESD on one USB port kills 5 V on both and drops CAN.",
      });
    }
  }

  if (wiringPower.pneumaticsEventRecorded) {
    if (!wiringPower.ventPlugAccessible) {
      flags.push({
        type: "pneumatics_vent_plug",
        severity: "critical",
        message:
          "Pneumatic vent plug is not marked easily accessible — inspectors fail a hidden plug and require gauges at 0 psi at power-off.",
      });
    }
    if (!wiringPower.singleOnboardCompressor) {
      flags.push({
        type: "pneumatics_multi_compressor",
        severity: "critical",
        message:
          "Onboard compressor is not marked as a single legal unit — extra compressors fail pneumatics inspection.",
      });
    }
  }

  const checkCount =
    (weightBudget.limitLbs > 0 ? 1 : 0) +
    (frameBumper.perimeterLimitIn > 0 ? 1 : 0) +
    (frameBumper.bumperMaxHeightIn > 0 || frameBumper.bumperMinHeightIn > 0 ? 1 : 0) +
    (frameBumper.bumperMinThicknessIn > 0 ? 1 : 0) +
    (frameBumper.bumperEventRecorded ? 2 : 0) +
    5 + // wiring/power checks are always evaluated
    (wiringPower.binderRecorded ? 3 : 0) +
    (wiringPower.radioEventRecorded ? 4 : 0) +
    (wiringPower.sparkMaxEventRecorded ? 1 : 0) +
    (wiringPower.reliabilityEventRecorded ? 8 : 0) +
    (wiringPower.pneumaticsEventRecorded ? 2 : 0);
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
