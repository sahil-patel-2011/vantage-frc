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
};

/** Team-declared wiring/power-distribution limits vs what was actually installed. */
export type WiringPowerSpec = {
  mainBreakerMaxAmps: number;
  installedMainBreakerAmps: number;
  batterySecured: boolean;
  wiresLabeled: boolean;
  radioPowerOk: boolean;
  bypassSwitchAccessible: boolean;
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
  | "bypass_switch_inaccessible";

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
