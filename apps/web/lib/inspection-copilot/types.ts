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
  /**
   * When false, 2026 bumper-construction flags are skipped (never invent hollow foam).
   * CD: hollow pool noodles are illegal; reversible sets keep failing at events.
   */
  bumperEventRecorded?: boolean;
  solidCoreFoam?: boolean;
  separateColorSets?: boolean;
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
   * CD / inspection checklist: hidden vent plugs and extra compressors stop Thursday.
   */
  pneumaticsEventRecorded?: boolean;
  ventPlugAccessible?: boolean;
  singleOnboardCompressor?: boolean;
};

export type InspectionFlagType =
  | "weight_over_limit"
  | "weight_near_limit"
  | "frame_perimeter_exceeded"
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
  | "pneumatics_vent_plug"
  | "pneumatics_multi_compressor";

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
