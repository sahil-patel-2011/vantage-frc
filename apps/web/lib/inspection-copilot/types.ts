// Inspection-readiness copilot domain types. Pure data shapes — no I/O, no framework imports.
// A check compares the team's declared inspection LIMITS (from the current manual — weight
// budget, frame perimeter, bumper height/thickness range, main breaker rating) against the
// MEASURED values on the actual robot to deterministically flag likely inspection failures
// before the team travels. Everything is grounded only in the limits and measurements the team
// supplies — nothing about rule numbers is invented or fetched.

export type WeightItem = {
  name: string;
  weightLbs: number;
};

/** Team-declared weight budget: the rule limit plus the itemized weigh-in. */
export type WeightBudgetSpec = {
  limitLbs: number;
  items: WeightItem[];
};

/** Team-declared frame/bumper limits (from the manual) vs what was actually measured. */
export type FrameBumperSpec = {
  perimeterLimitIn: number;
  measuredPerimeterIn: number;
  bumperMinHeightIn: number;
  bumperMaxHeightIn: number;
  measuredBumperMinHeightIn: number;
  measuredBumperMaxHeightIn: number;
  bumperMinThicknessIn: number;
  measuredBumperThicknessIn: number;
  /** 2026 R104 / R107 starting-config height. 0 skips the check (no measurement yet). */
  startingHeightLimitIn?: number;
  measuredStartingHeightIn?: number;
  /** 2026 R105 in-match horizontal extension. 0 measured skips the check. */
  extensionLimitIn?: number;
  measuredExtensionIn?: number;
  /**
   * When false, 2026 bumper-construction flags are skipped (never invent hollow foam).
   * CD: hollow pool noodles are illegal; reversible sets keep failing at events.
   * R401 gaps and R409 no electronics/moving parts fail Thursday.
   */
  bumperEventRecorded?: boolean;
  solidCoreFoam?: boolean;
  separateColorSets?: boolean;
  /** True once gaps are < 1.25 in, or the one larger gap leaves ≥ 5 in from each corner. */
  bumperGapsOk?: boolean;
  /** True once bumpers have no moving or electrical parts (R409). */
  bumperNoElectronics?: boolean;
  /** True once R412 numbers are 3.5 in white Arabic on ≥3 sides ~90° apart. */
  bumperNumbersLegal?: boolean;
  /** True once the bumper stack stays ≤ 4.25 in from the perimeter (R403, checklist). */
  bumperHardPartsOk?: boolean;
  /** True once corners have ≥ 2 in uncompressed fill (R406, checklist tolerance). */
  bumperCornersFilled?: boolean;
  /** True once hard parts stay ≤ 1.5 in from the perimeter (R404, checklist). */
  bumperHardPartsInset?: boolean;
  /** True once backing is ≥ 4.25 in tall and supports all padding (R402, checklist). */
  bumperBackingTall?: boolean;
};

/** Team-declared wiring/power-distribution limits vs what was actually installed. */
export type WiringPowerSpec = {
  mainBreakerMaxAmps: number;
  installedMainBreakerAmps: number;
  batterySecured: boolean;
  wiresLabeled: boolean;
  radioPowerOk: boolean;
  bypassSwitchAccessible: boolean;
  /**
   * When false, binder flags are skipped (not logged yet — never invent a missing BOM).
   * CD inspectors: bring a real printed BOM to every event.
   */
  binderRecorded: boolean;
  bomPrinted: boolean;
  inspectionChecklistPrinted: boolean;
  studentCaptainPresent: boolean;
  /**
   * When false, 2026 radio/RIO PD flags are skipped (never invent a wiring fail).
   * CD: rio/radio off Mini PD / RPM is a common inspection stop.
   */
  radioEventRecorded: boolean;
  radioOnMainPd: boolean;
  rioOnMainPd10A: boolean;
  radioProgrammedForEvent: boolean;
  /** True once a second person confirmed VH-109 Weidmuller leads have no stray strands. */
  radioWeidmullerQc: boolean;
  /** True once radio LEDs are visible to field staff, not only inspectors. */
  radioLedsVisible?: boolean;
  /** True once RIO ethernet is on a v1.5 RIO port, or v1.0 via PoE / modified cable / AUX DIP off. */
  rioEthernetPathOk?: boolean;
  /**
   * When false, Spark MAX USB flags are skipped (never invent a fried laptop).
   * CD 2026: USB-C into a shorted Spark MAX can back-feed and kill a motherboard.
   */
  sparkMaxEventRecorded: boolean;
  /** True once the team confirms they will not USB a Spark MAX that is behaving unexpectedly. */
  sparkMaxUsbAvoided: boolean;
  /**
   * When false, 2026 pit-reliability flags are skipped (never invent strain-relief / ESD fails).
   * CD: strain relief, igus pinch, ESD vs wiring, CANivore PDH backup, torqued leads, breaker cover.
   */
  reliabilityEventRecorded: boolean;
  strainReliefOk: boolean;
  dynamicCableClear: boolean;
  esdIntakeBonded: boolean;
  esdShielded: boolean;
  canivorePdhBackup: boolean;
  batteryLeadsTorqued: boolean;
  mainBreakerCovered: boolean;
  /** True once USB cameras are off the RIO USB ports next to a CANivore. */
  rioUsbCameraClear: boolean;
  /**
   * When false, pneumatics flags are skipped (robots without air never invent a vent-plug fail).
   * CD / inspection checklist: hidden vent plugs, extra compressors, 60 psi working pressure, and a missing pressure switch stop Thursday.
   */
  pneumaticsEventRecorded?: boolean;
  ventPlugAccessible?: boolean;
  singleOnboardCompressor?: boolean;
  /** True once the 125 psi relief valve is on the compressor outlet. */
  reliefValveOnCompressor?: boolean;
  /** True once working pressure is regulated to ≤ 60 psi. */
  workingPressure60Psi?: boolean;
  /** True once the pressure switch is wired to the PCM/PH. */
  pressureSwitchOnPcmPh?: boolean;
  /** True once working parts are ≥ 70 psi and stored parts ≥ 125 psi (R801/R802). */
  componentsRated?: boolean;
  /** True once the compressor stops at ≤ 120 psi under roboRIO control. */
  compressorStops120?: boolean;
  /** True once the compressor is powered from a PCM/PH or relay, not a motor controller. */
  compressorPowerOk?: boolean;
  /** True once tubing is KOP-equivalent with ≤ 1/4 in OD. */
  tubingOdOk?: boolean;
  /**
   * When false, R611 isolation / PDH-debris flags are skipped (never invent a chassis short).
   * CD: inspectors probe Anderson-to-frame with battery out and breaker on; debris in unused PDH slots reboots radios.
   */
  isolationEventRecorded?: boolean;
  frameIsolated120?: boolean;
  unusedPdPortsTaped?: boolean;
  /**
   * When false, RSL flags are skipped (never invent a missing signal light).
   * 2026 checklist: visible from 36 in on one side, plugged into the roboRIO RSL port, flashes in sync.
   */
  rslEventRecorded?: boolean;
  rslVisible36?: boolean;
  rslOnRioPort?: boolean;
};

export type InspectionFlagType =
  | "weight_over_limit"
  | "weight_near_limit"
  | "frame_perimeter_exceeded"
  | "starting_height_exceeded"
  | "extension_exceeded"
  | "bumper_height_out_of_range"
  | "bumper_undersized_thickness"
  | "main_breaker_oversized"
  | "battery_not_secured"
  | "wires_unlabeled"
  | "radio_power_fault"
  | "bypass_switch_inaccessible"
  | "bom_not_printed"
  | "inspection_checklist_not_printed"
  | "student_captain_absent"
  | "radio_not_on_main_pd"
  | "rio_not_on_main_pd"
  | "radio_not_programmed_for_event"
  | "radio_weidmuller_strands"
  | "radio_leds_hidden"
  | "rio_ethernet_path"
  | "spark_max_usb_risk"
  | "strain_relief_missing"
  | "dynamic_cable_pinch"
  | "esd_intake_unbonded"
  | "esd_unshielded"
  | "canivore_no_pdh_backup"
  | "battery_leads_loose"
  | "main_breaker_exposed"
  | "rio_usb_camera_canivore"
  | "bumper_hollow_foam"
  | "bumper_reversible"
  | "bumper_gaps"
  | "bumper_electronics"
  | "bumper_numbers"
  | "bumper_hard_parts"
  | "bumper_corners"
  | "bumper_hard_inset"
  | "bumper_backing"
  | "pneumatics_vent_plug"
  | "pneumatics_multi_compressor"
  | "pneumatics_relief_valve"
  | "pneumatics_working_pressure"
  | "pneumatics_pressure_switch"
  | "pneumatics_component_rating"
  | "pneumatics_compressor_stop"
  | "pneumatics_compressor_power"
  | "pneumatics_tubing_od"
  | "frame_not_isolated"
  | "pdh_ports_untaped"
  | "rsl_not_visible"
  | "rsl_not_on_rio_port";

export type InspectionFlagSeverity = "info" | "warning" | "critical";

export type InspectionFlag = {
  type: InspectionFlagType;
  severity: InspectionFlagSeverity;
  message: string;
};

/** Deterministic prediction result, grounded only in the supplied limits/measurements. */
export type InspectionPrediction = {
  flags: InspectionFlag[];
  /** 0..1, higher = more/worse predicted failures. */
  riskScore: number;
  totalWeightLbs: number;
  summary: string;
};

export type InspectionCopilotCheck = {
  id: string;
  seasonYear: number;
  robotName: string;
  weightBudget: WeightBudgetSpec;
  frameBumper: FrameBumperSpec;
  wiringPower: WiringPowerSpec;
  flags: InspectionFlag[];
  riskScore: number;
  totalWeightLbs: number;
  summary: string;
  createdAt: string;
  updatedAt: string;
};
