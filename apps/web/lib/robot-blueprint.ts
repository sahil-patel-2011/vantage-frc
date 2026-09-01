import { countMissingCad } from "./cad-vault/blueprint-coverage";

// Robot Blueprint (digital twin) — framework-free domain logic shared by the API
// route, the client UI, and unit tests. Ties CAD, code, strategy, and operational
// data together per robot subsystem. No server or React imports belong here.

export const SUBSYSTEM_STATUSES = [
  "concept",
  "designing",
  "prototyping",
  "built",
  "tested",
  "competition_ready",
] as const;
export type SubsystemStatus = (typeof SUBSYSTEM_STATUSES)[number];

export const STATUS_LABELS: Record<SubsystemStatus, string> = {
  concept: "Concept",
  designing: "Designing",
  prototyping: "Prototyping",
  built: "Built",
  tested: "Tested",
  competition_ready: "Competition ready",
};

/** Build-completeness weight per status (drives the readiness score). */
export const STATUS_WEIGHT: Record<SubsystemStatus, number> = {
  concept: 0,
  designing: 0.15,
  prototyping: 0.4,
  built: 0.65,
  tested: 0.85,
  competition_ready: 1,
};

/** Common FRC subsystem seed set. */
export const SEED_SUBSYSTEMS: Array<{ name: string; description: string }> = [
  { name: "Drivetrain", description: "Chassis, gearboxes, and drive control" },
  { name: "Intake", description: "Game-piece acquisition" },
  { name: "Scorer", description: "Primary scoring mechanism" },
  { name: "Elevator / Arm", description: "Vertical or articulated reach" },
  { name: "Climber", description: "Endgame climb mechanism" },
  { name: "Electronics", description: "Power, wiring, and control board" },
  { name: "Vision & Sensors", description: "Cameras, localization, and sensing" },
];

export type RobotSubsystem = {
  id: string;
  robotLabel: string;
  name: string;
  description: string;
  status: SubsystemStatus;
  cadUrl: string | null;
  /** Non-archived cad_documents rows linked to this subsystem. Optional for callers that only have a URL. */
  vaultDocumentCount?: number;
  codeRef: string;
  priorityId: string | null;
  priorityCapability: string | null;
  priorityStatus: string | null;
  practiceAction: string | null;
  bomSubsystem: string;
  sortOrder: number;
};

export type SubsystemOps = {
  practice: { reps: number; successRate: number | null; avgSeconds: number | null } | null;
  bom: { buildable: boolean; shortCount: number } | null;
  failures7d: number;
  openMaintenance: number;
};

export type EnrichedSubsystem = RobotSubsystem & { ops: SubsystemOps };

export type BlueprintContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
  seasonYear: number;
};

export type PriorityOption = { id: string; capability: string; weight: number; status: string };

export type BlueprintView =
  | {
      status: "ready";
      context: BlueprintContext;
      subsystems: EnrichedSubsystem[];
      priorities: PriorityOption[];
    }
  | { status: "setup_required"; context: BlueprintContext; message: string };

// ---------------------------------------------------------------------------
// Derived metrics (pure, unit-tested).
// ---------------------------------------------------------------------------

/** Label CAD hosts for link buttons. */
export function cadProvider(url: string | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "cad.onshape.com" || host.endsWith(".onshape.com")) return "Onshape";
    if (host.includes("autodesk") || host === "a360.co" || host.includes("fusion")) return "Fusion 360";
    if (host === "grabcad.com" || host.endsWith(".grabcad.com")) return "GrabCAD";
    return "CAD";
  } catch {
    return null;
  }
}

/** Validate an optional https CAD URL (max 500 chars); normalized string or null. */
export function optionalCadUrl(value: unknown): string | null {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (text.length > 500) throw new Error("CAD link must be 500 characters or fewer");
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error("CAD link must be a full https:// URL");
  }
  if (parsed.protocol !== "https:") throw new Error("CAD link must use https");
  if (!parsed.hostname.includes(".")) throw new Error("CAD link must be a full https:// URL");
  return parsed.toString();
}

export type SubsystemReadiness = { percent: number; blockers: string[] };

/**
 * Readiness = status weight, capped by operational blockers: BOM shortfalls cap
 * at 70, recent failures at 80, open maintenance at 90. Blockers are listed so
 * the UI/AI can say exactly why a subsystem is held back.
 */
export function subsystemReadiness(subsystem: EnrichedSubsystem): SubsystemReadiness {
  let percent = Math.round(STATUS_WEIGHT[subsystem.status] * 100);
  const blockers: string[] = [];
  if (subsystem.ops.bom && !subsystem.ops.bom.buildable) {
    blockers.push(`${subsystem.ops.bom.shortCount} BOM part${subsystem.ops.bom.shortCount === 1 ? "" : "s"} short`);
    percent = Math.min(percent, 70);
  }
  if (subsystem.ops.failures7d > 0) {
    blockers.push(`${subsystem.ops.failures7d} failure${subsystem.ops.failures7d === 1 ? "" : "s"} in 7d`);
    percent = Math.min(percent, 80);
  }
  if (subsystem.ops.openMaintenance > 0) {
    blockers.push(`${subsystem.ops.openMaintenance} open maintenance`);
    percent = Math.min(percent, 90);
  }
  return { percent, blockers };
}

export type RobotRollup = {
  percent: number;
  total: number;
  ready: number; // competition_ready count
  blockers: number;
  missingCad: number;
  missingCode: number;
  unlinkedStrategy: number;
  untested: number; // no practice reps recorded
};

export function robotRollup(subsystems: EnrichedSubsystem[]): RobotRollup {
  if (subsystems.length === 0) {
    return { percent: 0, total: 0, ready: 0, blockers: 0, missingCad: 0, missingCode: 0, unlinkedStrategy: 0, untested: 0 };
  }
  const readiness = subsystems.map((subsystem) => subsystemReadiness(subsystem));
  return {
    percent: Math.round(readiness.reduce((sum, value) => sum + value.percent, 0) / subsystems.length),
    total: subsystems.length,
    ready: subsystems.filter((subsystem) => subsystem.status === "competition_ready").length,
    blockers: readiness.reduce((sum, value) => sum + value.blockers.length, 0),
    missingCad: countMissingCad(subsystems),
    missingCode: subsystems.filter((subsystem) => !subsystem.codeRef.trim()).length,
    unlinkedStrategy: subsystems.filter((subsystem) => !subsystem.priorityId).length,
    untested: subsystems.filter((subsystem) => (subsystem.ops.practice?.reps ?? 0) === 0).length,
  };
}

// ---------------------------------------------------------------------------
// Action validation (mirrors the other module parse patterns).
// ---------------------------------------------------------------------------

function requiredText(value: unknown, label: string, max: number) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return text;
}

function optionalText(value: unknown, max: number) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) throw new Error(`Value must be ${max} characters or fewer`);
  return text;
}

function uuid(value: unknown, label: string) {
  const text = requiredText(value, label, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function optionalUuid(value: unknown, label: string) {
  if (value == null || value === "") return null;
  return uuid(value, label);
}

function robotLabel(value: unknown) {
  return optionalText(value, 40) ?? "competition";
}

const has = (body: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(body, key);

export type SubsystemPatch = {
  name?: string;
  description?: string;
  status?: SubsystemStatus;
  cadUrl?: string | null;
  codeRef?: string;
  priorityId?: string | null;
  practiceAction?: string | null;
  bomSubsystem?: string;
  sortOrder?: number;
};

export type BlueprintAction =
  | { action: "seed_subsystems"; orgId: string; robotLabel: string }
  | { action: "add_subsystem"; orgId: string; robotLabel: string; name: string; description: string }
  | { action: "update_subsystem"; orgId: string; id: string; patch: SubsystemPatch }
  | { action: "delete_subsystem"; orgId: string; id: string };

export function parseBlueprintAction(input: unknown): BlueprintAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid blueprint action");
  const body = input as Record<string, unknown>;
  const action = requiredText(body.action, "Action", 40);
  const orgId = uuid(body.orgId, "Organization");

  switch (action) {
    case "seed_subsystems":
      return { action, orgId, robotLabel: robotLabel(body.robotLabel) };

    case "add_subsystem":
      return {
        action,
        orgId,
        robotLabel: robotLabel(body.robotLabel),
        name: requiredText(body.name, "Subsystem name", 80),
        description: optionalText(body.description, 500) ?? "",
      };

    case "update_subsystem": {
      const patch: SubsystemPatch = {};
      if (has(body, "name")) patch.name = requiredText(body.name, "Subsystem name", 80);
      if (has(body, "description")) patch.description = optionalText(body.description, 500) ?? "";
      if (has(body, "status")) {
        const status = requiredText(body.status, "Status", 40) as SubsystemStatus;
        if (!SUBSYSTEM_STATUSES.includes(status)) throw new Error("Invalid subsystem status");
        patch.status = status;
      }
      if (has(body, "cadUrl")) patch.cadUrl = optionalCadUrl(body.cadUrl);
      if (has(body, "codeRef")) patch.codeRef = optionalText(body.codeRef, 300) ?? "";
      if (has(body, "priorityId")) patch.priorityId = optionalUuid(body.priorityId, "Priority");
      if (has(body, "practiceAction")) patch.practiceAction = optionalText(body.practiceAction, 80);
      if (has(body, "bomSubsystem")) patch.bomSubsystem = optionalText(body.bomSubsystem, 80) ?? "";
      if (has(body, "sortOrder")) {
        const sort = Number(body.sortOrder);
        if (!Number.isInteger(sort) || sort < 0 || sort > 10_000) throw new Error("Sort order is invalid");
        patch.sortOrder = sort;
      }
      if (Object.keys(patch).length === 0) throw new Error("No changes provided");
      return { action, orgId, id: uuid(body.id, "Subsystem"), patch };
    }

    case "delete_subsystem":
      return { action, orgId, id: uuid(body.id, "Subsystem") };

    default:
      throw new Error("Unsupported blueprint action");
  }
}
