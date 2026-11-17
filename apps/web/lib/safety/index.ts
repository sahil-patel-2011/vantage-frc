// Safety-captain tooling for an FRC team: an incident / near-miss log and a
// tool-safety certification register (who is cleared to run the mill, bandsaw,
// etc.). Pure validation + rollup math lives here so the API and UI agree.

export const INCIDENT_SEVERITIES = ["near_miss", "minor", "moderate", "serious"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];
export const INCIDENT_STATUSES = ["open", "reviewed", "closed"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const TREATMENTS = ["none", "first_aid", "professional"] as const;
export type Treatment = (typeof TREATMENTS)[number];

export const CERT_TYPES = [
  "general_safety",
  "hand_tools",
  "power_tools",
  "mill_lathe",
  "bandsaw",
  "drill_press",
  "welding",
  "3d_printer",
  "electrical",
  "battery",
  "first_aid",
  "other",
] as const;
export type CertType = (typeof CERT_TYPES)[number];

export const CERT_TYPE_LABEL: Record<CertType, string> = {
  general_safety: "General safety",
  hand_tools: "Hand tools",
  power_tools: "Power tools",
  mill_lathe: "Mill / lathe",
  bandsaw: "Bandsaw",
  drill_press: "Drill press",
  welding: "Welding",
  "3d_printer": "3D printer",
  electrical: "Electrical",
  battery: "Battery handling",
  first_aid: "First aid / CPR",
  other: "Other",
};

const SEVERITY_RANK: Record<IncidentSeverity, number> = { near_miss: 0, minor: 1, moderate: 2, serious: 3 };
export const CERT_EXPIRING_WINDOW_DAYS = 30;

export type CertExpiry = "valid" | "expiring" | "expired" | "no_expiry";

function isValidDate(text: string) {
  return !Number.isNaN(new Date(text).getTime());
}

function daysBetween(fromIso: string, toIso: string) {
  return Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / (1000 * 60 * 60 * 24));
}

export function certExpiryStatus(expiresOn: string | null, now: Date): CertExpiry {
  if (!expiresOn) return "no_expiry";
  const nowIso = now.toISOString();
  const remaining = daysBetween(nowIso, expiresOn);
  if (remaining < 0) return "expired";
  if (remaining <= CERT_EXPIRING_WINDOW_DAYS) return "expiring";
  return "valid";
}

export type IncidentInput = { title: string; severity: IncidentSeverity; occurredOn: string; status: IncidentStatus };

export function validateIncident(raw: Record<string, unknown>): { ok: true; value: IncidentInput } | { ok: false; error: string } {
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return { ok: false, error: "Title is required" };
  const severity = String(raw.severity ?? "");
  if (!INCIDENT_SEVERITIES.includes(severity as IncidentSeverity)) return { ok: false, error: "Invalid severity" };
  const occurredOn = typeof raw.occurredOn === "string" ? raw.occurredOn : "";
  if (!occurredOn || !isValidDate(occurredOn)) return { ok: false, error: "A valid date is required" };
  return { ok: true, value: { title, severity: severity as IncidentSeverity, occurredOn, status: "open" } };
}

export function validateCertification(
  raw: Record<string, unknown>,
): { ok: true; value: { personName: string; certType: CertType; completedOn: string; expiresOn: string | null } } | { ok: false; error: string } {
  const personName = typeof raw.personName === "string" ? raw.personName.trim() : "";
  if (!personName) return { ok: false, error: "Person name is required" };
  const certType = String(raw.certType ?? "");
  if (!CERT_TYPES.includes(certType as CertType)) return { ok: false, error: "Invalid certification type" };
  const completedOn = typeof raw.completedOn === "string" ? raw.completedOn : "";
  if (!completedOn || !isValidDate(completedOn)) return { ok: false, error: "A valid completion date is required" };
  const expiresRaw = typeof raw.expiresOn === "string" ? raw.expiresOn.trim() : "";
  if (expiresRaw && !isValidDate(expiresRaw)) return { ok: false, error: "Invalid expiry date" };
  return { ok: true, value: { personName, certType: certType as CertType, completedOn, expiresOn: expiresRaw || null } };
}

export function summarizeSafety(input: {
  incidents: { severity: IncidentSeverity; status: IncidentStatus; occurredOn: string }[];
  certifications: { expiresOn: string | null }[];
  now: Date;
}) {
  const open = input.incidents.filter((i) => i.status !== "closed");
  const lastIncidentOn = input.incidents.length
    ? input.incidents.map((i) => i.occurredOn).sort((a, b) => b.localeCompare(a))[0]!
    : null;
  const expiryStatuses = input.certifications.map((c) => certExpiryStatus(c.expiresOn, input.now));
  return {
    openIncidents: open.length,
    seriousOpen: open.filter((i) => SEVERITY_RANK[i.severity] >= SEVERITY_RANK.moderate).length,
    daysSinceLastIncident: lastIncidentOn ? Math.max(0, daysBetween(lastIncidentOn, input.now.toISOString())) : null,
    expiringCerts: expiryStatuses.filter((s) => s === "expiring").length,
    expiredCerts: expiryStatuses.filter((s) => s === "expired").length,
  };
}

// ---- request validation for the API route --------------------------------

export type SafetyAction =
  | { action: "log_incident"; orgId: string; title: string; severity: IncidentSeverity; occurredOn: string; location: string; description: string; injuredPerson: string; treatment: Treatment; correctiveAction: string }
  | { action: "set_incident_status"; orgId: string; id: string; status: IncidentStatus; correctiveAction: string | null }
  | { action: "delete_incident"; orgId: string; id: string }
  | { action: "add_certification"; orgId: string; personName: string; certType: CertType; completedOn: string; expiresOn: string | null; notes: string }
  | { action: "delete_certification"; orgId: string; id: string };

function reqStr(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}
function optStr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseSafetyAction(raw: unknown): SafetyAction {
  if (!raw || typeof raw !== "object") throw new Error("Invalid request body");
  const body = raw as Record<string, unknown>;
  const action = reqStr(body.action, "action");
  const orgId = reqStr(body.orgId, "orgId");

  switch (action) {
    case "log_incident": {
      const validated = validateIncident(body);
      if (!validated.ok) throw new Error(validated.error);
      const treatment = optStr(body.treatment) || "none";
      if (!TREATMENTS.includes(treatment as Treatment)) throw new Error("Invalid treatment");
      return {
        action, orgId,
        title: validated.value.title, severity: validated.value.severity, occurredOn: validated.value.occurredOn,
        location: optStr(body.location), description: optStr(body.description), injuredPerson: optStr(body.injuredPerson),
        treatment: treatment as Treatment, correctiveAction: optStr(body.correctiveAction),
      };
    }
    case "set_incident_status": {
      const status = reqStr(body.status, "status");
      if (!INCIDENT_STATUSES.includes(status as IncidentStatus)) throw new Error("Invalid status");
      return { action, orgId, id: reqStr(body.id, "id"), status: status as IncidentStatus, correctiveAction: body.correctiveAction !== undefined ? optStr(body.correctiveAction) : null };
    }
    case "delete_incident":
      return { action, orgId, id: reqStr(body.id, "id") };
    case "add_certification": {
      const validated = validateCertification(body);
      if (!validated.ok) throw new Error(validated.error);
      return { action, orgId, ...validated.value, notes: optStr(body.notes) };
    }
    case "delete_certification":
      return { action, orgId, id: reqStr(body.id, "id") };
    default:
      throw new Error("Unsupported safety action");
  }
}
