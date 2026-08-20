// Pure, framework-free wiring/power fault diagnosis math. Everything here is deterministic and
// grounded only in the expected (wiring diagram + power budget) and observed (board photo
// inspection) circuits the caller supplies — it never fabricates a fault or a device.
// compute-wiring-diagnoser.ts wraps this with DB I/O; the API route and client render results.

import type {
  DiagnosticFlag,
  DiagnosticSeverity,
  ExpectedCircuit,
  ObservedCircuit,
  WireGauge,
  WiringDiagnosis,
} from "./types";

export const WIRE_GAUGES: WireGauge[] = ["22", "20", "18", "16", "14", "12", "10", "6", "4"];

/** Standard FRC control-system breaker sizes (PDP/PDH), amps. */
export const STANDARD_BREAKER_AMPS: number[] = [5, 7.5, 10, 15, 20, 30, 40, 60];

/** Conservative continuous-duty ampacity for short chassis-wire runs, by AWG gauge.
 *  6 / 4 AWG are battery-cable sizes for the PDH main feed (not chassis branches). */
export const WIRE_GAUGE_MAX_AMPS: Record<WireGauge, number> = {
  "22": 7,
  "20": 9,
  "18": 14,
  "16": 18,
  "14": 25,
  "12": 30,
  "10": 40,
  "6": 120,
  "4": 150,
};

/** A channel running at/above this fraction of its breaker rating is at risk of nuisance trips. */
export const OVERSPEC_MARGIN = 0.8;

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export function diagnosticSeverityLabel(severity: DiagnosticSeverity): string {
  switch (severity) {
    case "critical":
      return "Critical";
    case "warning":
      return "Warning";
    default:
      return "Info";
  }
}

const SEVERITY_WEIGHT: Record<DiagnosticSeverity, number> = {
  critical: 1,
  warning: 0.4,
  info: 0.1,
};

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

/** CD 2026: high-strand 4 AWG melted PDH battery inputs; REV ferrules stop at 6 AWG. */
export function looksLikePdhMainFeed(deviceName: string): boolean {
  const hay = deviceName.toLowerCase();
  if (/\b(pdh|pdp)\b/.test(hay) && /\b(main|battery|input)\b/.test(hay)) return true;
  return /main battery|battery input|battery main/.test(hay);
}

/** CD / R618 / Q58: one wire per PD terminal. Cue only when the pit walk logged extra conductors. */
export function r618MultiWireCue(deviceName: string): string {
  return `${deviceName}: more than one wire in the PD terminal — R618 fails a stuffed ferrule or soldered splice (Q58); twin ferrules only if the ferrule is rated for two wires.`;
}

/** Only when the team logged 4 AWG on a PDH/PDP main — never invent a gauge. */
export function pdhMainFeedCue(deviceName: string, wireGauge: WireGauge): string | null {
  if (wireGauge !== "4" || !looksLikePdhMainFeed(deviceName)) return null;
  return `${deviceName}: 4 AWG PDH mains melted hubs this year (high-strand + trapped air). REV ferrules stop at 6 AWG — use lower-strand 6 AWG, not a 4 AWG ferrule.`;
}

/**
 * Compare the declared wiring diagram + power budget (expected) against the physical board
 * inspection (observed) and flag miswires, undersized breakers, undersized wire for the
 * installed breaker, and channels running close to their breaker's trip point.
 */
export function diagnoseWiring(
  expected: ExpectedCircuit[],
  observed: ObservedCircuit[],
): WiringDiagnosis {
  const flags: DiagnosticFlag[] = [];
  const observedByChannel = new Map<number, ObservedCircuit>();
  for (const circuit of observed) observedByChannel.set(circuit.channel, circuit);
  const expectedChannels = new Set(expected.map((circuit) => circuit.channel));

  for (const exp of expected) {
    const obs = observedByChannel.get(exp.channel);
    if (!obs) {
      flags.push({
        channel: exp.channel,
        type: "missing_circuit",
        severity: "critical",
        message: `Channel ${exp.channel} (${exp.deviceName}) is in the wiring diagram but was not found on the board.`,
      });
      continue;
    }

    if (normalizeName(obs.deviceName) !== normalizeName(exp.deviceName)) {
      flags.push({
        channel: exp.channel,
        type: "miswire",
        severity: "critical",
        message: `Channel ${exp.channel} should carry "${exp.deviceName}" per the wiring diagram, but the board shows "${obs.deviceName}".`,
      });
    }

    const maxAmpsForWire = WIRE_GAUGE_MAX_AMPS[obs.wireGauge];
    if (obs.breakerAmps > maxAmpsForWire) {
      flags.push({
        channel: exp.channel,
        type: "wire_undersized_for_breaker",
        severity: "critical",
        message: `Channel ${exp.channel}: ${obs.breakerAmps}A breaker exceeds the ${maxAmpsForWire}A rating of ${obs.wireGauge} AWG wire — the wire, not the breaker, will fail first.`,
      });
    }

    if (obs.breakerAmps < exp.expectedCurrentDrawAmps) {
      flags.push({
        channel: exp.channel,
        type: "undersized_breaker",
        severity: "critical",
        message: `Channel ${exp.channel} (${exp.deviceName}): ${obs.breakerAmps}A breaker is below the ${exp.expectedCurrentDrawAmps}A expected draw — likely to trip under normal load.`,
      });
    } else if (exp.expectedCurrentDrawAmps >= obs.breakerAmps * OVERSPEC_MARGIN) {
      flags.push({
        channel: exp.channel,
        type: "oversized_channel",
        severity: "warning",
        message: `Channel ${exp.channel} (${exp.deviceName}): expected draw ${exp.expectedCurrentDrawAmps}A is within ${Math.round(
          (1 - OVERSPEC_MARGIN) * 100,
        )}% of the ${obs.breakerAmps}A breaker — margin is tight, watch for nuisance trips.`,
      });
    }

    if (obs.breakerAmps !== exp.breakerAmps && obs.breakerAmps >= exp.expectedCurrentDrawAmps) {
      flags.push({
        channel: exp.channel,
        type: "undersized_breaker",
        severity: "info",
        message: `Channel ${exp.channel}: installed breaker is ${obs.breakerAmps}A, diagram calls for ${exp.breakerAmps}A.`,
      });
    }

    const pdhCue = pdhMainFeedCue(obs.deviceName, obs.wireGauge);
    if (pdhCue) {
      flags.push({
        channel: exp.channel,
        type: "pdh_4awg_feed",
        severity: "warning",
        message: pdhCue,
      });
    }

    if (obs.multiWireTerminal) {
      flags.push({
        channel: exp.channel,
        type: "r618_multi_wire",
        severity: "critical",
        message: r618MultiWireCue(obs.deviceName),
      });
    }
  }

  for (const obs of observed) {
    if (!expectedChannels.has(obs.channel)) {
      flags.push({
        channel: obs.channel,
        type: "unexpected_circuit",
        severity: "warning",
        message: `Channel ${obs.channel} (${obs.deviceName}) is wired on the board but is not in the wiring diagram.`,
      });
      if (obs.multiWireTerminal) {
        flags.push({
          channel: obs.channel,
          type: "r618_multi_wire",
          severity: "critical",
          message: r618MultiWireCue(obs.deviceName),
        });
      }
    }
  }

  const circuitCount = Math.max(1, expected.length);
  const weighted = flags.reduce((sum, flag) => sum + SEVERITY_WEIGHT[flag.severity], 0);
  const riskScore = round(clamp01(weighted / (circuitCount * 1.2)));

  const criticalCount = flags.filter((flag) => flag.severity === "critical").length;
  const warningCount = flags.filter((flag) => flag.severity === "warning").length;
  const summary =
    flags.length === 0
      ? `All ${circuitCount} circuit(s) match the wiring diagram — no miswires or breaker issues found.`
      : `${criticalCount} critical and ${warningCount} warning issue(s) found across ${circuitCount} circuit(s).`;

  return { flags, riskScore, summary };
}
