// Cross-surface battery reliability: one fleet summary feeds Pit Command release
// gates, Event Day pit flags, FMEA/risk register signals, and readiness widgets.
// Canonical store is battery_packs + battery_logs (see migration 0153_battery_canonical).

import { batteryHealth, type BatteryHealth, type HealthStatus } from "./battery";

/** Pit UI historically used "service"; packs use "quarantine". */
export type PitBatteryStatus = "active" | "service" | "retired";
export type PackStatus = "active" | "quarantine" | "retired";

export type BatteryGate = "ready" | "review" | "unread";

export type FleetPackInput = {
  id: string;
  label: string;
  status: PackStatus | PitBatteryStatus | string;
  measuredAt: string | null;
  voltage: number | null;
  resistanceMilliohms: number | null;
  cycleCount?: number | null;
  ageMonths?: number | null;
  now?: number;
};

export type FleetPackView = FleetPackInput & {
  pitStatus: PitBatteryStatus;
  gate: BatteryGate;
  health: BatteryHealth;
};

export type FleetReliability = {
  activeCount: number;
  readyCount: number;
  serviceCount: number;
  retiredCount: number;
  agingCount: number;
  retireHealthCount: number;
  unreadCount: number;
  packs: FleetPackView[];
};

export type BatteryPitFlag = {
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  evidence: string;
};

export type BatteryFmeaSignal = {
  id: string;
  title: string;
  category: "technical" | "safety";
  likelihood: number;
  impact: number;
  detail: string;
  href: string;
};

const READY_MAX_AGE_MS = 18 * 60 * 60 * 1_000;
const READY_MIN_VOLTAGE = 12.5;
const READY_MAX_RESISTANCE = 25;

export function packStatusToPit(status: string): PitBatteryStatus {
  if (status === "quarantine" || status === "service") return "service";
  if (status === "retired") return "retired";
  return "active";
}

export function pitStatusToPack(status: PitBatteryStatus): PackStatus {
  if (status === "service") return "quarantine";
  if (status === "retired") return "retired";
  return "active";
}

/**
 * Match-ready gate used by Pit Command / Event Day. Stricter than long-term
 * `batteryHealth` wear grading: needs a fresh reading in the ready voltage/IR band.
 */
export function classifyMatchReady(input: {
  status: string;
  voltage: number | null;
  resistanceMilliohms: number | null;
  measuredAt?: string | null;
  healthStatus?: HealthStatus;
  now?: number;
}): BatteryGate {
  const pitStatus = packStatusToPit(input.status);
  if (pitStatus !== "active") return "unread";
  if (input.healthStatus === "retire") return "review";
  if (input.voltage == null && input.resistanceMilliohms == null) return "unread";
  if (input.measuredAt && (input.now ?? Date.now()) - new Date(input.measuredAt).getTime() > READY_MAX_AGE_MS) {
    return "review";
  }
  const voltageOk = input.voltage == null || input.voltage >= READY_MIN_VOLTAGE;
  const resistanceOk = input.resistanceMilliohms == null || input.resistanceMilliohms <= READY_MAX_RESISTANCE;
  return voltageOk && resistanceOk ? "ready" : "review";
}

export function summarizeFleet(packs: FleetPackInput[]): FleetReliability {
  const views: FleetPackView[] = packs.map((pack) => {
    const health = batteryHealth({
      internalResistanceMohm: pack.resistanceMilliohms,
      restingVoltage: pack.voltage,
      cycleCount: pack.cycleCount,
      ageMonths: pack.ageMonths,
    });
    const pitStatus = packStatusToPit(pack.status);
    const gate = classifyMatchReady({
      status: pack.status,
      voltage: pack.voltage,
      resistanceMilliohms: pack.resistanceMilliohms,
      measuredAt: pack.measuredAt,
      healthStatus: health.status,
      now: pack.now,
    });
    return { ...pack, pitStatus, gate, health };
  });

  return {
    activeCount: views.filter((p) => p.pitStatus === "active").length,
    readyCount: views.filter((p) => p.gate === "ready").length,
    serviceCount: views.filter((p) => p.pitStatus === "service").length,
    retiredCount: views.filter((p) => p.pitStatus === "retired").length,
    agingCount: views.filter((p) => p.health.status === "aging").length,
    retireHealthCount: views.filter((p) => p.health.status === "retire").length,
    unreadCount: views.filter((p) => p.pitStatus === "active" && p.gate === "unread").length,
    packs: views,
  };
}

/** Event Day / Pit Command flags derived only from logged fleet evidence. */
export function batteryPitFlags(fleet: FleetReliability, orgId: string): BatteryPitFlag[] {
  const flags: BatteryPitFlag[] = [];
  const hrefEvidence = `Battery fleet · /batteries?orgId=${orgId}`;

  if (fleet.packs.length === 0) {
    flags.push({
      severity: "warning",
      title: "No batteries tracked",
      detail: "Log packs on Batteries or Pit Command so release readiness is evidence-based.",
      evidence: hrefEvidence,
    });
    return flags;
  }

  if (!fleet.activeCount) {
    flags.push({
      severity: "critical",
      title: "No active battery on the rack",
      detail: "Every pack is quarantined or retired — return a healthy pack to active before the next match.",
      evidence: hrefEvidence,
    });
  } else if (!fleet.readyCount) {
    flags.push({
      severity: "critical",
      title: "No match-ready battery",
      detail: "Active packs need a fresh reading (≥12.5 V, ≤25 mΩ, measured within 18h) before release.",
      evidence: hrefEvidence,
    });
  } else if (fleet.readyCount === 1 && fleet.activeCount > 1) {
    flags.push({
      severity: "info",
      title: "Only one match-ready pack",
      detail: `${fleet.readyCount} of ${fleet.activeCount} active packs are in the ready band.`,
      evidence: hrefEvidence,
    });
  }

  if (fleet.retireHealthCount > 0) {
    const labels = fleet.packs
      .filter((p) => p.health.status === "retire")
      .map((p) => p.label)
      .slice(0, 3)
      .join(", ");
    flags.push({
      severity: "warning",
      title: `${fleet.retireHealthCount} pack${fleet.retireHealthCount === 1 ? "" : "s"} past retire threshold`,
      detail: `Internal resistance / wear on ${labels}${fleet.retireHealthCount > 3 ? "…" : ""} — quarantine or replace before relying on them.`,
      evidence: hrefEvidence,
    });
  } else if (fleet.agingCount > 0) {
    flags.push({
      severity: "info",
      title: `${fleet.agingCount} aging pack${fleet.agingCount === 1 ? "" : "s"}`,
      detail: "Elevated IR, age, or cycles — prioritize fresher packs for match rotation.",
      evidence: hrefEvidence,
    });
  }

  return flags;
}

/**
 * FMEA-lite signals for the Risk Register. Derived from real fleet measurements;
 * never invents packs or scores when nothing is logged.
 */
export function batteryFmeaSignals(fleet: FleetReliability, orgId: string): BatteryFmeaSignal[] {
  const signals: BatteryFmeaSignal[] = [];
  const href = `/batteries?orgId=${encodeURIComponent(orgId)}`;

  if (fleet.packs.length === 0) return signals;

  if (!fleet.readyCount) {
    signals.push({
      id: "battery-no-ready",
      title: "Brownout / no match-ready battery",
      category: "technical",
      likelihood: fleet.activeCount ? 4 : 5,
      impact: 5,
      detail: fleet.activeCount
        ? "Active packs are out of the ready voltage/IR window or stale — high occurrence of mid-match brownouts if fielded."
        : "No active packs on the rack.",
      href,
    });
  }

  if (fleet.retireHealthCount > 0) {
    signals.push({
      id: "battery-retire-wear",
      title: "Battery pack(s) past retire IR threshold",
      category: "technical",
      likelihood: Math.min(5, 2 + fleet.retireHealthCount),
      impact: 4,
      detail: `${fleet.retireHealthCount} pack(s) graded retire by internal resistance / wear math. Detection is high if Beak tests continue; occurrence rises if they stay in rotation.`,
      href,
    });
  }

  if (fleet.serviceCount > 0 && fleet.readyCount <= 1) {
    signals.push({
      id: "battery-thin-rotation",
      title: "Thin battery rotation under quarantine load",
      category: "technical",
      likelihood: 3,
      impact: 3,
      detail: `${fleet.serviceCount} quarantined · ${fleet.readyCount} ready — limited spares if a pack fails at the event.`,
      href,
    });
  }

  return signals;
}

export function batteryReadinessChecklist(fleet: FleetReliability) {
  return [
    {
      label: "Active batteries tracked",
      ready: fleet.activeCount > 0,
      detail: fleet.activeCount ? `${fleet.activeCount} active` : "None logged",
    },
    {
      label: "Match-ready pack available",
      ready: fleet.readyCount > 0,
      detail: fleet.readyCount ? `${fleet.readyCount} ready` : fleet.activeCount ? "None in ready band" : "No active packs",
    },
    {
      label: "No retire-threshold packs in rotation",
      ready: fleet.retireHealthCount === 0,
      detail: fleet.retireHealthCount ? `${fleet.retireHealthCount} need quarantine` : "Clear",
    },
  ];
}

export const BATTERY_READY_RULE =
  "Active + measured in the last 18 hours + at least 12.5 V + at most 25 mΩ (and not past retire IR)";
