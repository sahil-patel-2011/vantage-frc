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

/** 2026 R104 starting-config perimeter (in). */
export const R104_PERIMETER_LIMIT_IN = 110;
/** 2026 R104 / R107 starting and match height (in). */
export const R104_HEIGHT_LIMIT_IN = 30;
/** 2026 inspection checklist bumper zone (tolerance already applied). */
export const CHECKLIST_BUMPER_MIN_HEIGHT_IN = 2.75;
export const CHECKLIST_BUMPER_MAX_HEIGHT_IN = 5.5;
/** 2026 inspection checklist padding minimum (tolerance already applied). */
export const CHECKLIST_BUMPER_MIN_THICKNESS_IN = 2;
/** 2026 R105 in-match horizontal extension (in). Last year was 16. */
export const R105_EXTENSION_LIMIT_IN = 12;

export const STALE_120_PERIMETER_CUE =
  "Starting-config perimeter is still 120 in — 2026 R104 is 110 in around and 30 in tall.";
export const STALE_BUMPER_ZONE_CUE =
  "Bumper zone max is still 7.5 in — 2026 inspectors use 2.75–5.5 in from the floor (checklist, tolerance applied).";
export const STALE_BUMPER_THICKNESS_CUE =
  "Bumper padding minimum is still 1 in — 2026 checklist is 2 in solid-core (2.25 in nominal in the manual).";
export const STALE_16_EXTENSION_CUE =
  "In-match extension is still 16 in — 2026 R105 is 12 in past the robot perimeter, one direction at a time.";

export function stale120PerimeterCue(limitIn: number): string | null {
  if (limitIn !== 120) return null;
  return STALE_120_PERIMETER_CUE;
}

export function staleBumperZoneCue(maxHeightIn: number): string | null {
  if (maxHeightIn < 7) return null;
  return STALE_BUMPER_ZONE_CUE;
}

export function staleBumperThicknessCue(minThicknessIn: number): string | null {
  if (minThicknessIn !== 1) return null;
  return STALE_BUMPER_THICKNESS_CUE;
}

export function stale16ExtensionCue(limitIn: number): string | null {
  if (limitIn !== 16) return null;
  return STALE_16_EXTENSION_CUE;
}

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

  if (
    (frameBumper.startingHeightLimitIn ?? 0) > 0 &&
    (frameBumper.measuredStartingHeightIn ?? 0) > (frameBumper.startingHeightLimitIn ?? 0)
  ) {
    flags.push({
      type: "starting_height_exceeded",
      severity: "critical",
      message: `Measured starting height ${frameBumper.measuredStartingHeightIn} in exceeds the ${frameBumper.startingHeightLimitIn} in 2026 limit (R104 / R107).`,
    });
  }

  if (
    (frameBumper.extensionLimitIn ?? 0) > 0 &&
    (frameBumper.measuredExtensionIn ?? 0) > (frameBumper.extensionLimitIn ?? 0)
  ) {
    flags.push({
      type: "extension_exceeded",
      severity: "critical",
      message: `Measured in-match extension ${frameBumper.measuredExtensionIn} in exceeds the ${frameBumper.extensionLimitIn} in 2026 limit (R105 — 12 in, one direction).`,
    });
  }

  if (frameBumper.bumperMaxHeightIn > 0 || frameBumper.bumperMinHeightIn > 0) {
    const measured =
      frameBumper.measuredBumperMinHeightIn > 0 || frameBumper.measuredBumperMaxHeightIn > 0;
    if (
      measured &&
      (frameBumper.measuredBumperMinHeightIn < frameBumper.bumperMinHeightIn ||
        frameBumper.measuredBumperMaxHeightIn > frameBumper.bumperMaxHeightIn)
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
    frameBumper.measuredBumperThicknessIn > 0 &&
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
    if (!frameBumper.bumperGapsOk) {
      flags.push({
        type: "bumper_gaps",
        severity: "critical",
        message:
          "Bumper gaps are not marked legal — 2026 R401 allows gaps under 1.25 in, or one larger gap with at least 5 in of bumper from each corner.",
      });
    }
    if (!frameBumper.bumperNoElectronics) {
      flags.push({
        type: "bumper_electronics",
        severity: "critical",
        message:
          "Bumpers are not marked free of moving or electrical parts — 2026 R409 fails lights, actuators, and moving bumper hardware.",
      });
    }
    if (!frameBumper.bumperNumbersLegal) {
      flags.push({
        type: "bumper_numbers",
        severity: "critical",
        message:
          "Bumper numbers are not marked 2026-legal — R412 is white Arabic numerals ≥ 3.5 in tall × 0.25 in stroke on at least 3 sides about 90° apart, not last year's four-side default.",
      });
    }
    if (!frameBumper.bumperHardPartsOk) {
      flags.push({
        type: "bumper_hard_parts",
        severity: "critical",
        message:
          "Bumper stack is not marked within 4.25 in of the robot perimeter — 2026 R403 / checklist fails a bumper that sticks out farther than that (4 in nominal in the manual).",
      });
    }
    if (!frameBumper.bumperCornersFilled) {
      flags.push({
        type: "bumper_corners",
        severity: "critical",
        message:
          "Bumper corners are not marked filled — 2026 R406 / checklist wants ≥ 2 in uncompressed padding measured diagonally (2.25 in nominal in the manual).",
      });
    }
    if (!frameBumper.bumperHardPartsInset) {
      flags.push({
        type: "bumper_hard_inset",
        severity: "critical",
        message:
          "Hard bumper parts are not marked within 1.5 in of the robot perimeter — 2026 R404 / checklist also wants padding ≥ 2 in past any hard parts (1.25 in nominal in the manual).",
      });
    }
    if (!frameBumper.bumperBackingTall) {
      flags.push({
        type: "bumper_backing",
        severity: "critical",
        message:
          "Bumper backing is not marked ≥ 4.25 in tall supporting all padding — 2026 R402 / checklist fails cantilevered foam and short plywood (4.5 in nominal in the manual).",
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
    if (!wiringPower.radioLedsVisible) {
      flags.push({
        type: "radio_leds_hidden",
        severity: "critical",
        message:
          "Radio LEDs are not marked visible to field staff — 2026 inspectors fail a buried VH-109 even if it passed a pit look.",
      });
    }
    if (!wiringPower.rioEthernetPathOk) {
      flags.push({
        type: "rio_ethernet_path",
        severity: "critical",
        message:
          "roboRIO ethernet is not marked on a legal VH-109 path — v1.5 uses the RIO port; v1.0 needs a PoE injector, modified cable, or AUX with DIP off.",
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
    if (!wiringPower.reliefValveOnCompressor) {
      flags.push({
        type: "pneumatics_relief_valve",
        severity: "critical",
        message:
          "Compressor relief valve is not marked on the compressor outlet at 125 psi — inspectors fail a valve on the tank instead of the compressor.",
      });
    }
    if (!wiringPower.workingPressure60Psi) {
      flags.push({
        type: "pneumatics_working_pressure",
        severity: "critical",
        message:
          "Working pressure is not marked regulated to 60 psi — inspectors fail stored-pressure systems that feed actuators above the legal working limit.",
      });
    }
    if (!wiringPower.pressureSwitchOnPcmPh) {
      flags.push({
        type: "pneumatics_pressure_switch",
        severity: "critical",
        message:
          "Pressure switch is not marked wired to the PCM/PH — the compressor has to stop at the stored-pressure setpoint, not run open-loop.",
      });
    }
    if (!wiringPower.componentsRated) {
      flags.push({
        type: "pneumatics_component_rating",
        severity: "critical",
        message:
          "Pneumatic parts are not marked pressure-rated — 2026 R801/R802 fail working components under 70 psi and stored components under 125 psi.",
      });
    }
    if (!wiringPower.compressorStops120) {
      flags.push({
        type: "pneumatics_compressor_stop",
        severity: "critical",
        message:
          "Compressor is not marked stopping at ≤ 120 psi under roboRIO control — inspectors fail a system that keeps charging past stored pressure.",
      });
    }
    if (!wiringPower.compressorPowerOk) {
      flags.push({
        type: "pneumatics_compressor_power",
        severity: "critical",
        message:
          "Compressor is not marked powered from a PCM/PH or relay — inspectors fail a compressor on a motor controller or raw PDH branch.",
      });
    }
    if (!wiringPower.tubingOdOk) {
      flags.push({
        type: "pneumatics_tubing_od",
        severity: "critical",
        message:
          "Pneumatic tubing is not marked KOP-equivalent ≤ 1/4 in OD — inspectors fail oversized tube (bring documentation if it is not KOP stock).",
      });
    }
    if (!wiringPower.relievingRegulatorOk) {
      flags.push({
        type: "pneumatics_relieving_regulator",
        severity: "critical",
        message:
          "Working pressure is not marked through a relieving regulator — inspectors fail a non-relieving regulator even if the gauge reads 60 psi.",
      });
    }
    if (!wiringPower.compressorStartsEnabled) {
      flags.push({
        type: "pneumatics_compressor_start",
        severity: "critical",
        message:
          "Compressor is not marked starting when the robot is enabled with no stored pressure — inspectors fail a compressor that stays off until a code workaround.",
      });
    }
  }

  if (wiringPower.isolationEventRecorded) {
    if (!wiringPower.frameIsolated120) {
      flags.push({
        type: "frame_not_isolated",
        severity: "critical",
        message:
          "Frame is not marked isolated >120Ω from PD Anderson posts (battery out, breaker on) — R611 fails chassis used as a wire.",
      });
    }
    if (!wiringPower.unusedPdPortsTaped) {
      flags.push({
        type: "pdh_ports_untaped",
        severity: "warning",
        message:
          "Unused PDH / RIO / VRM ports are not marked taped — conductive debris in those sockets reboots radios mid-match.",
      });
    }
  }

  if (wiringPower.rslEventRecorded) {
    if (!wiringPower.rslVisible36) {
      flags.push({
        type: "rsl_not_visible",
        severity: "critical",
        message:
          "Robot signal light is not marked visible from 36 in on at least one side — inspectors fail an RSL they cannot see from the side of the robot.",
      });
    }
    if (!wiringPower.rslOnRioPort) {
      flags.push({
        type: "rsl_not_on_rio_port",
        severity: "critical",
        message:
          "Robot signal light is not marked plugged into the roboRIO RSL port and flashing in sync — PWM or extra LEDs do not count.",
      });
    }
  }

  const checkCount =
    (weightBudget.limitLbs > 0 ? 1 : 0) +
    (frameBumper.perimeterLimitIn > 0 ? 1 : 0) +
    ((frameBumper.startingHeightLimitIn ?? 0) > 0 ? 1 : 0) +
    ((frameBumper.extensionLimitIn ?? 0) > 0 ? 1 : 0) +
    (frameBumper.bumperMaxHeightIn > 0 || frameBumper.bumperMinHeightIn > 0 ? 1 : 0) +
    (frameBumper.bumperMinThicknessIn > 0 ? 1 : 0) +
    (frameBumper.bumperEventRecorded ? 9 : 0) +
    5 + // wiring/power checks are always evaluated
    (wiringPower.binderRecorded ? 3 : 0) +
    (wiringPower.radioEventRecorded ? 6 : 0) +
    (wiringPower.sparkMaxEventRecorded ? 1 : 0) +
    (wiringPower.reliabilityEventRecorded ? 8 : 0) +
    (wiringPower.pneumaticsEventRecorded ? 11 : 0) +
    (wiringPower.isolationEventRecorded ? 2 : 0) +
    (wiringPower.rslEventRecorded ? 2 : 0);
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
