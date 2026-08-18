// Battery pack tracking for FRC robots. Teams run a fleet of 12V SLA packs
// (typically 18Ah, e.g. MK ES17-12) and must rotate, charge, and retire them.
// This module holds the pure health/rotation math and request validation; the
// API route and client both import it so the rules live in exactly one place.

export const BATTERY_STATUSES = ["active", "quarantine", "retired"] as const;
export type BatteryStatus = (typeof BATTERY_STATUSES)[number];

export const BATTERY_LOG_KINDS = [
  "charge",
  "storage_charge",
  "match",
  "practice",
  "resistance_test",
  "note",
  "retire",
  "return_to_service",
] as const;
export type BatteryLogKind = (typeof BATTERY_LOG_KINDS)[number];

/** A logged match or practice run is one discharge cycle against the pack. */
export const CYCLE_KINDS: BatteryLogKind[] = ["match", "practice"];
const CHARGE_KINDS: BatteryLogKind[] = ["charge", "storage_charge"];

// Health thresholds tuned for FRC-spec 12V SLA packs. Internal resistance is the
// single best wear signal (measured with a Battery Beak / CBA); a healthy pack
// reads ~11-13 mΩ new and climbs as plates degrade.
export const RESISTANCE_AGING_MOHM = 15;
export const RESISTANCE_RETIRE_MOHM = 20;
export const VOLTAGE_LOW = 12.0;
export const VOLTAGE_FULL = 12.8;
export const AGE_AGING_MONTHS = 48;
export const CYCLES_AGING = 300;

export type HealthStatus = "good" | "aging" | "retire";
export type BatteryHealth = { status: HealthStatus; score: number; reasons: string[] };

const RANK: Record<HealthStatus, number> = { good: 0, aging: 1, retire: 2 };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Grades a pack from its most recent measurements plus wear counters. `status`
 * drives the go/no-go badge; `score` (0-100, higher is healthier) ranks packs
 * for match rotation so the freshest battery gets picked next.
 */
export function batteryHealth(input: {
  internalResistanceMohm?: number | null;
  restingVoltage?: number | null;
  cycleCount?: number | null;
  ageMonths?: number | null;
}): BatteryHealth {
  const reasons: string[] = [];
  let status: HealthStatus = "good";
  const escalate = (next: HealthStatus) => {
    if (RANK[next] > RANK[status]) status = next;
  };

  const { internalResistanceMohm, restingVoltage, cycleCount, ageMonths } = input;

  if (internalResistanceMohm != null) {
    if (internalResistanceMohm >= RESISTANCE_RETIRE_MOHM) {
      escalate("retire");
      reasons.push(`Internal resistance ${internalResistanceMohm} mΩ is at or past the retire threshold`);
    } else if (internalResistanceMohm >= RESISTANCE_AGING_MOHM) {
      escalate("aging");
      reasons.push(`Internal resistance ${internalResistanceMohm} mΩ is elevated`);
    }
  }
  if (restingVoltage != null && restingVoltage < VOLTAGE_LOW) {
    escalate("aging");
    reasons.push(`Resting voltage ${restingVoltage} V is low`);
  }
  if (ageMonths != null && ageMonths >= AGE_AGING_MONTHS) {
    escalate("aging");
    reasons.push(`About ${Math.round(ageMonths / 12)} years old`);
  }
  if (cycleCount != null && cycleCount >= CYCLES_AGING) {
    escalate("aging");
    reasons.push(`${cycleCount} cycles logged`);
  }

  let score = 100;
  if (internalResistanceMohm != null) score -= clamp((internalResistanceMohm - 12) * 5, 0, 60);
  if (restingVoltage != null) score -= clamp((VOLTAGE_FULL - restingVoltage) * 10, 0, 25);
  if (cycleCount != null) score -= clamp(cycleCount * 0.05, 0, 15);
  if (ageMonths != null) score -= clamp(ageMonths * 0.2, 0, 15);
  score = clamp(Math.round(score), 0, 100);
  if (status === "good" && score < 50) {
    escalate("aging");
    reasons.push("Composite health score is low");
  }

  return { status, score, reasons };
}

export type BatteryLogInput = {
  kind: BatteryLogKind;
  restingVoltage: number | null;
  internalResistanceMohm: number | null;
  matchKey: string | null;
  createdAt: string;
};

/** Rolls an append-only log stream up into the counters `batteryHealth` needs. */
export function summarizeLogs(logs: BatteryLogInput[]) {
  const sorted = [...logs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const cycleCount = sorted.filter((log) => CYCLE_KINDS.includes(log.kind)).length;
  const lastInternalResistanceMohm =
    sorted.find((log) => log.internalResistanceMohm != null)?.internalResistanceMohm ?? null;
  const lastRestingVoltage = sorted.find((log) => log.restingVoltage != null)?.restingVoltage ?? null;
  const lastUsedAt = sorted.find((log) => CYCLE_KINDS.includes(log.kind))?.createdAt ?? null;
  const lastChargedAt = sorted.find((log) => CHARGE_KINDS.includes(log.kind))?.createdAt ?? null;
  return { cycleCount, lastInternalResistanceMohm, lastRestingVoltage, lastUsedAt, lastChargedAt };
}

export function monthsBetween(fromIso: string | null, now: Date): number | null {
  if (!fromIso) return null;
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return null;
  const months = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
  return Math.max(0, months);
}

/** Pit / event-day go window: reading age, resting voltage, and IR gates. */
export const READINESS_MAX_AGE_MS = 18 * 60 * 60 * 1_000;
export const READINESS_MIN_VOLTAGE = 12.5;
export const READINESS_MAX_RESISTANCE_MOHM = 25;

/**
 * Competition readiness for a single pack — same gates Pit Command uses so
 * `/batteries` and `/pit` never disagree about "event ready".
 */
export function competitionReadiness(input: {
  status: BatteryStatus;
  health: BatteryHealth;
  lastMeasuredAt: string | null;
  lastRestingVoltage: number | null;
  lastInternalResistanceMohm: number | null;
  now?: Date;
}): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const nowMs = (input.now ?? new Date()).getTime();

  if (input.status !== "active") {
    reasons.push(input.status === "quarantine" ? "Pack is quarantined" : "Pack is retired");
  }
  if (input.health.status === "retire") reasons.push("Health grade says retire");
  else if (input.health.status === "aging") reasons.push("Health grade is aging");

  if (input.lastRestingVoltage == null && input.lastInternalResistanceMohm == null) {
    reasons.push("No voltage or resistance reading yet");
  } else {
    if (input.lastMeasuredAt) {
      const age = nowMs - new Date(input.lastMeasuredAt).getTime();
      if (Number.isFinite(age) && age > READINESS_MAX_AGE_MS) {
        reasons.push("Last reading is older than 18 hours");
      }
    } else {
      reasons.push("Last reading time is unknown");
    }
    if (input.lastRestingVoltage != null && input.lastRestingVoltage < READINESS_MIN_VOLTAGE) {
      reasons.push(`Resting voltage ${input.lastRestingVoltage} V is below ${READINESS_MIN_VOLTAGE} V`);
    }
    if (input.lastInternalResistanceMohm != null && input.lastInternalResistanceMohm > READINESS_MAX_RESISTANCE_MOHM) {
      reasons.push(`Internal resistance ${input.lastInternalResistanceMohm} mΩ is above ${READINESS_MAX_RESISTANCE_MOHM} mΩ`);
    }
  }

  return { ready: reasons.length === 0, reasons };
}

/** Killer Bees cart: 10–15 min cool-down after charger before a Beak test (hot reading is a false high). */
export const CART_COOLDOWN_MINUTES = 15;

export type CartSlotKind = "parked" | "needs_charge" | "cooling" | "ready_to_test" | "ready";

export type CartSlot = {
  kind: CartSlotKind;
  label: string;
  minutesRemaining: number | null;
  detail: string;
};

function minutesSince(fromIso: string, nowIso: string): number | null {
  const start = Date.parse(fromIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(start) || !Number.isFinite(now)) return null;
  return Math.round((now - start) / 60000);
}

/**
 * Competition-cart slot from logged charge / match / Beak times — never invents Ready.
 * Drive team can grab `ready`; Battery Czar watches `cooling` then tests.
 */
export function cartSlot(input: {
  status: BatteryStatus;
  lastChargedAt: string | null;
  lastUsedAt: string | null;
  lastTestedAt: string | null;
  nowIso: string;
}): CartSlot {
  if (input.status !== "active") {
    return {
      kind: "parked",
      label: input.status === "quarantine" ? "Quarantine" : "Retired",
      minutesRemaining: null,
      detail: "Not on the competition cart.",
    };
  }

  const usedMs = input.lastUsedAt ? Date.parse(input.lastUsedAt) : NaN;
  const chargedMs = input.lastChargedAt ? Date.parse(input.lastChargedAt) : NaN;
  const testedMs = input.lastTestedAt ? Date.parse(input.lastTestedAt) : NaN;

  if (Number.isFinite(usedMs) && (!Number.isFinite(chargedMs) || usedMs > chargedMs)) {
    return {
      kind: "needs_charge",
      label: "Needs charge",
      minutesRemaining: null,
      detail: "Last log was a match or practice — plug it in before it can cool.",
    };
  }

  if (!Number.isFinite(chargedMs) || !input.lastChargedAt) {
    return {
      kind: "needs_charge",
      label: "No charge logged",
      minutesRemaining: null,
      detail: "Log a charge to start the 15-minute cool-down slot.",
    };
  }

  const elapsed = minutesSince(input.lastChargedAt, input.nowIso);
  if (elapsed == null || elapsed < CART_COOLDOWN_MINUTES) {
    const remaining = elapsed == null ? CART_COOLDOWN_MINUTES : Math.max(0, CART_COOLDOWN_MINUTES - elapsed);
    return {
      kind: "cooling",
      label: "Cooling",
      minutesRemaining: remaining,
      detail: `Off the charger — wait ${remaining} min before a Beak test (hot voltage is a false high).`,
    };
  }

  if (!Number.isFinite(testedMs) || testedMs <= chargedMs) {
    return {
      kind: "ready_to_test",
      label: "Cool — test now",
      minutesRemaining: 0,
      detail: "Cooldown done. Battery Czar: Beak test, then write Ready.",
    };
  }

  return {
    kind: "ready",
    label: "Ready",
    minutesRemaining: 0,
    detail: "Tested after cooldown — drive team can take this pack.",
  };
}

/**
 * Ranks active packs for the next match: healthiest first, and among equals the
 * one used longest ago, so the fleet wears evenly. Non-active packs drop out.
 */
export function rankForRotation<T extends { status: BatteryStatus; health: BatteryHealth; lastUsedAt: string | null }>(
  packs: T[],
): T[] {
  return packs
    .filter((pack) => pack.status === "active" && pack.health.status !== "retire")
    .sort((a, b) => {
      if (b.health.score !== a.health.score) return b.health.score - a.health.score;
      return (a.lastUsedAt ?? "").localeCompare(b.lastUsedAt ?? "");
    });
}

// ---- request validation -------------------------------------------------

export type BatteryAction =
  | { action: "create_pack"; orgId: string; label: string; brand: string | null; nominalAh: number | null; purchaseDate: string | null; assignment: string; notes: string; initialResistanceMohm: number | null; initialVoltage: number | null }
  | { action: "update_pack"; orgId: string; id: string; patch: { label?: string; brand?: string | null; nominalAh?: number | null; purchaseDate?: string | null; assignment?: string; notes?: string } }
  | { action: "assign_pack"; orgId: string; id: string; assignment: string }
  | { action: "set_status"; orgId: string; id: string; status: BatteryStatus; note: string }
  | { action: "delete_pack"; orgId: string; id: string }
  | { action: "log_event"; orgId: string; batteryId: string; kind: BatteryLogKind; restingVoltage: number | null; internalResistanceMohm: number | null; matchKey: string | null; note: string };

function asRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") throw new Error("Invalid request body");
  return raw as Record<string, unknown>;
}
function reqStr(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}
function optStr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function optNum(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${field} must be a non-negative number`);
  return parsed;
}
function nullableDate(value: unknown): string | null {
  const text = optStr(value);
  if (!text) return null;
  if (Number.isNaN(new Date(text).getTime())) throw new Error("Invalid date");
  return text;
}

export function parseBatteryAction(raw: unknown): BatteryAction {
  const body = asRecord(raw);
  const action = reqStr(body.action, "action");
  const orgId = reqStr(body.orgId, "orgId");

  switch (action) {
    case "create_pack":
      return {
        action, orgId,
        label: reqStr(body.label, "label"),
        brand: optStr(body.brand) || null,
        nominalAh: optNum(body.nominalAh, "nominalAh"),
        purchaseDate: nullableDate(body.purchaseDate),
        assignment: optStr(body.assignment),
        notes: optStr(body.notes),
        initialResistanceMohm: optNum(body.initialResistanceMohm, "initialResistanceMohm"),
        initialVoltage: optNum(body.initialVoltage, "initialVoltage"),
      };
    case "update_pack": {
      const patch: { label?: string; brand?: string | null; nominalAh?: number | null; purchaseDate?: string | null; assignment?: string; notes?: string } = {};
      if (body.label !== undefined) patch.label = reqStr(body.label, "label");
      if (body.brand !== undefined) patch.brand = optStr(body.brand) || null;
      if (body.nominalAh !== undefined) patch.nominalAh = optNum(body.nominalAh, "nominalAh");
      if (body.purchaseDate !== undefined) patch.purchaseDate = nullableDate(body.purchaseDate);
      if (body.assignment !== undefined) patch.assignment = optStr(body.assignment);
      if (body.notes !== undefined) patch.notes = optStr(body.notes);
      if (Object.keys(patch).length === 0) throw new Error("No changes provided");
      return { action, orgId, id: reqStr(body.id, "id"), patch };
    }
    case "assign_pack":
      return { action, orgId, id: reqStr(body.id, "id"), assignment: optStr(body.assignment) };
    case "set_status": {
      const status = reqStr(body.status, "status");
      if (!BATTERY_STATUSES.includes(status as BatteryStatus)) throw new Error("Invalid status");
      return { action, orgId, id: reqStr(body.id, "id"), status: status as BatteryStatus, note: optStr(body.note) };
    }
    case "delete_pack":
      return { action, orgId, id: reqStr(body.id, "id") };
    case "log_event": {
      const kind = reqStr(body.kind, "kind");
      if (!BATTERY_LOG_KINDS.includes(kind as BatteryLogKind)) throw new Error("Invalid log kind");
      return {
        action, orgId,
        batteryId: reqStr(body.batteryId, "batteryId"),
        kind: kind as BatteryLogKind,
        restingVoltage: optNum(body.restingVoltage, "restingVoltage"),
        internalResistanceMohm: optNum(body.internalResistanceMohm, "internalResistanceMohm"),
        matchKey: optStr(body.matchKey) || null,
        note: optStr(body.note),
      };
    }
    default:
      throw new Error("Unsupported battery action");
  }
}
