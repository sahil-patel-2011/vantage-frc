import { classifyMatchReady, type PitBatteryStatus } from "./battery-reliability";

export const PIT_SEVERITIES = ["minor", "degraded", "disabled", "safety"] as const;
export const BATTERY_STATUSES = ["active", "service", "retired"] as const;
type Severity = (typeof PIT_SEVERITIES)[number];
type BatteryStatus = PitBatteryStatus;

export type PitAction =
  | { action: "report_issue"; orgId: string; subsystem: string; severity: Severity; symptoms: string; matchKey: string | null }
  | { action: "resolve_issue"; orgId: string; id: string; resolution: string }
  | { action: "log_battery"; orgId: string; assetTag: string; voltage: number | null; resistanceMilliohms: number | null; chargerCycles: number | null }
  | { action: "battery_status"; orgId: string; id: string; status: BatteryStatus }
  | { action: "add_maintenance"; orgId: string; subsystem: string; task: string; dueAt: string | null }
  | { action: "complete_maintenance"; orgId: string; id: string };

function text(value: unknown, label: string, max: number, optional = false) {
  const result = String(value ?? "").trim();
  if (!result && !optional) throw new Error(`${label} is required`);
  if (result.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return result || null;
}
function uuid(value: unknown, label: string) {
  const result = text(value, label, 64)!;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) throw new Error(`${label} is invalid`);
  return result;
}
function number(value: unknown, label: string, max: number) {
  if (value === "" || value == null) return null;
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > max) throw new Error(`${label} must be between 0 and ${max}`);
  return result;
}

export function parsePitAction(input: unknown): PitAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid pit action");
  const body = input as Record<string, unknown>;
  const action = text(body.action, "Action", 40)!;
  const orgId = uuid(body.orgId, "Organization");
  if (action === "report_issue") {
    const severity = text(body.severity, "Severity", 20)!;
    if (!PIT_SEVERITIES.includes(severity as Severity)) throw new Error("Invalid issue severity");
    return { action, orgId, subsystem: text(body.subsystem, "Subsystem", 80)!, severity: severity as Severity, symptoms: text(body.symptoms, "Symptoms", 2_000)!, matchKey: text(body.matchKey, "Match", 80, true) };
  }
  if (action === "resolve_issue") return { action, orgId, id: uuid(body.id, "Issue"), resolution: text(body.resolution, "Resolution", 2_000)! };
  if (action === "log_battery") {
    const voltage = number(body.voltage, "Voltage", 20);
    const resistanceMilliohms = number(body.resistanceMilliohms, "Internal resistance", 100);
    const chargerCycles = number(body.chargerCycles, "Charger cycles", 100_000);
    if (voltage == null && resistanceMilliohms == null && chargerCycles == null) throw new Error("Enter at least one battery measurement");
    return { action, orgId, assetTag: text(body.assetTag, "Battery tag", 40)!.toUpperCase(), voltage, resistanceMilliohms, chargerCycles: chargerCycles == null ? null : Math.floor(chargerCycles) };
  }
  if (action === "battery_status") {
    const status = text(body.status, "Battery status", 20)!;
    if (!BATTERY_STATUSES.includes(status as BatteryStatus)) throw new Error("Invalid battery status");
    return { action, orgId, id: uuid(body.id, "Battery"), status: status as BatteryStatus };
  }
  if (action === "add_maintenance") {
    const raw = text(body.dueAt, "Due time", 64, true);
    let dueAt: string | null = null;
    if (raw) {
      const due = new Date(raw);
      if (Number.isNaN(due.getTime())) throw new Error("Due time is invalid");
      dueAt = due.toISOString();
    }
    return { action, orgId, subsystem: text(body.subsystem, "Subsystem", 80)!, task: text(body.task, "Maintenance task", 500)!, dueAt };
  }
  if (action === "complete_maintenance") return { action, orgId, id: uuid(body.id, "Maintenance item") };
  throw new Error("Unsupported pit action");
}

/** @deprecated Prefer classifyMatchReady from battery-reliability; kept for pit tests/call sites. */
export function classifyBattery(input: { status: string; voltage: number | null; resistanceMilliohms: number | null; measuredAt?: string | null; now?: number }) {
  return classifyMatchReady(input);
}

export function computeReleaseGate(input: { safetyIssues: number; disabledIssues: number; overdueMaintenance: number; readyBatteries: number; activeBatteries: number }) {
  const reasons: string[] = [];
  if (input.safetyIssues) reasons.push(`${input.safetyIssues} unresolved safety issue${input.safetyIssues === 1 ? "" : "s"}`);
  if (input.disabledIssues) reasons.push(`${input.disabledIssues} unresolved disabled issue${input.disabledIssues === 1 ? "" : "s"}`);
  if (input.overdueMaintenance) reasons.push(`${input.overdueMaintenance} overdue maintenance item${input.overdueMaintenance === 1 ? "" : "s"}`);
  if (!input.activeBatteries) reasons.push("No active battery is tracked");
  else if (!input.readyBatteries) reasons.push("No active battery is in the ready range");
  if (input.safetyIssues || input.disabledIssues) return { state: "hold" as const, reasons };
  if (reasons.length) return { state: "check" as const, reasons };
  return { state: "go" as const, reasons: ["No release blockers found in Pit Command"] };
}
