// Wiring/power fault diagnoser domain types. Pure data shapes — no I/O, no framework imports.
// A wiring check compares the wiring diagram the team declared for a control board (PDP/PDH
// channel -> device -> wire gauge -> breaker) against what a pit crew member observed on the
// physical board (from the photo), plus the power budget draw expected on each channel, to flag
// miswires, undersized breakers, and over-spec (near-trip) channels. Everything is grounded only
// in the circuits the team supplies — nothing is inferred from the photo pixels themselves.

export type WireGauge = "22" | "20" | "18" | "16" | "14" | "12" | "10" | "6" | "4";

export type DiagnosticFlagType =
  | "miswire"
  | "missing_circuit"
  | "unexpected_circuit"
  | "undersized_breaker"
  | "wire_undersized_for_breaker"
  | "oversized_channel"
  | "pdh_4awg_feed"
  | "r618_multi_wire";

export type DiagnosticSeverity = "info" | "warning" | "critical";

/** A circuit as declared in the team's stored wiring diagram + power budget. */
export type ExpectedCircuit = {
  channel: number;
  deviceName: string;
  wireGauge: WireGauge;
  breakerAmps: number;
  /** Expected steady-state/peak current draw for this device, from the power budget. */
  expectedCurrentDrawAmps: number;
};

/** A circuit as observed on the physical board (from the photo / pit inspection). */
export type ObservedCircuit = {
  channel: number;
  deviceName: string;
  wireGauge: WireGauge;
  breakerAmps: number;
  /** True once the pit walk saw more than one conductor in this PD terminal (R618). */
  multiWireTerminal?: boolean;
};

/**
 * A device pulled from the team's stored wiring/CAN-bus map (robot_devices) for the active
 * season. Used to prefill expected circuits so a check is grounded in the diagram the team
 * already maintains rather than hand-retyped. wireGauge / expected draw are not tracked on the
 * wiring map, so they're left for the operator to fill from the power budget.
 */
export type WiringMapDevice = {
  channel: number;
  deviceName: string;
  breakerAmps: number | null;
  subsystem: string | null;
};

export type DiagnosticFlag = {
  channel: number;
  type: DiagnosticFlagType;
  severity: DiagnosticSeverity;
  message: string;
};

/** Deterministic diagnosis result, grounded only in the supplied expected/observed circuits. */
export type WiringDiagnosis = {
  flags: DiagnosticFlag[];
  /** 0..1, higher = more/worse faults relative to circuit count. */
  riskScore: number;
  summary: string;
};

export type WiringCheck = {
  id: string;
  seasonYear: number;
  boardName: string;
  photoUrl: string | null;
  expectedCircuits: ExpectedCircuit[];
  observedCircuits: ObservedCircuit[];
  flags: DiagnosticFlag[];
  riskScore: number;
  summary: string;
  createdAt: string;
  updatedAt: string;
};
