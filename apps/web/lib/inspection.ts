// Robot Inspection & Weigh-in — framework-free domain logic shared by the API
// route, the client UI, and unit tests. No server or React imports belong here.

export const INSPECTION_STATUSES = ["pending", "pass", "fail", "na"] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export const DEFAULT_WEIGHT_LIMIT_LBS = 115;

/**
 * Year-agnostic FRC inspection template based on the perennial R-rules areas.
 * Teams tick these off before the real inspector arrives; game-specific rules
 * can be added as custom items each season.
 */
export const INSPECTION_TEMPLATE: Array<{ category: string; items: string[] }> = [
  {
    category: "Chassis & Bumpers",
    items: [
      "Robot fits within starting size configuration",
      "Starting volume: perimeter ≤ 110 in, height ≤ 30 in (R104)",
      "Starting configuration does not overhang the robot perimeter",
      "In-match extension ≤ 12 in horizontally (one direction at a time) and ≤ 30 in tall; bumpers stay in the bumper zone",
      "Frame perimeter is rigid, continuous, and non-articulated; minor protrusions ≤ 0.25 in (R101)",
      "Bumpers cover the required frame perimeter",
      "Bumper gaps < 1.25 in, or one larger gap with ≥ 5 in coverage from each corner (R401)",
      "Bumpers have no moving or electrical parts (R409)",
      "Bumpers do not extend > 4.25 in from the robot perimeter (R403)",
      "Hard bumper parts ≤ 1.5 in from the robot perimeter; padding extends ≥ 2 in beyond hard parts (R404)",
      "Bumper backing ≥ 4.25 in tall and supports all padding (R402)",
      "Bumper corners filled with ≥ 2 in uncompressed padding, measured diagonally (R406)",
      "Bumper padding is solid-core foam (hollow pool noodles are not legal)",
      "Separate red and blue bumper sets (reversible fabric eats weight and fails often)",
      "Team number: white Arabic numerals ≥ 3.5 in tall × 0.25 in stroke on at least 3 sides ~90° apart (R412)",
      "Bumpers mount securely, sit in the legal height zone, and are easily removable for inspection",
      "Bumper cloth cover covers all padding (R402)",
      "No sharp edges, pinch points, or protrusions",
    ],
  },
  {
    category: "Electrical",
    items: [
      "Single legal battery, securely mounted and connected",
      "Main breaker (120A) accessible and labeled",
      "Power distribution wiring uses legal gauge and colors",
      "PDH ATM fuses ≤ 15A except one 20A powering a PCM/PH (or a 20A breaker)",
      "roboRIO powered directly from the PDP/PDH",
      "Radio powered by RIO-port injection and/or 12V from a PD (not VRM/RPM); LEDs visible to field staff",
      "roboRIO ethernet on VH-109 v1.5 RIO port, or v1.0 via PoE injector / modified cable / AUX with DIP off",
      "Frame electrically isolated (>120Ω) from PD Anderson posts (battery out, breaker on)",
      "All motors and actuators are legal and correctly breakered",
      "Battery terminals insulated; no exposed conductors",
      "Robot signal light visible from 36 in on at least one side, on the roboRIO RSL port, flashing in sync",
    ],
  },
  {
    category: "Pneumatics",
    items: [
      "Only legal pneumatic components (or none on the robot)",
      "Stored pressure ≤ 120 psi; working pressure regulated to 60 psi",
      "Working-pressure parts rated ≥ 70 psi; stored-pressure parts rated ≥ 125 psi (R801/R802)",
      "Compressor stops automatically at ≤ 120 psi under roboRIO control",
      "Pressure switch wired to the PCM/PH so the compressor stops at the stored-pressure setpoint",
      "Pressure relief valve on the compressor outlet, set to 125 psi",
      "Easily accessible vent plug vents all stored pressure (gauges read 0 psi)",
      "Only one onboard legal compressor (n/a if the robot has no pneumatics)",
      "Compressor powered from a PCM/PH or relay module (not a motor controller)",
      "Pneumatic tubing equivalent to KOP, maximum OD 1/4 in",
      "Relieving pressure regulator ≤ 60 psi providing all working pressure",
      "Compressor starts when the robot is enabled with no stored pressure",
      "PCM/PH mounted away from the radio (RF looks like a compressor fault)",
      "No painting or large labels on tanks/cylinders (small labels and unused mount pins ok)",
      "Solenoid valves ≤ 1/8 in NPT (or 1/4 in QC), PCM/PH or relay control, outputs not combined",
      "Gauges on stored and working sides of the regulator, readily visible (R805-E / R810)",
    ],
  },
  {
    category: "General & Safety",
    items: [
      "Robot ≤ 115 lb excluding bumpers and battery (R103)",
      "Robot + bumpers ≤ 135 lb (R408)",
      "All swap mechanisms together ≤ 150 lb at inspection (I103)",
      "Operator console smaller than 60×16×78 in",
      "No unauthorized wireless on the DS or in the pit",
      "No prohibited materials (liquids, hazardous chemicals)",
      "Energy sources are legal (battery, pneumatics, springs)",
      "All software/firmware is competition-legal versions",
      "roboRIO image 2026_v1.2 or later; Driver Station / Game Tools 26.0 or later",
      "Robot can be safely transported, lifted, and disabled",
    ],
  },
];

export type InspectionItem = {
  id: string;
  robotLabel: string;
  category: string;
  requirement: string;
  status: InspectionStatus;
  note: string;
  isCustom: boolean;
  sortOrder: number;
  checkedByName: string | null;
  checkedAt: string | null;
};

export type RobotWeight = {
  id: string;
  robotLabel: string;
  totalLbs: number;
  config: string;
  note: string;
  weighedAt: string;
  recordedByName: string | null;
};

export type InspectionContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
};

export type InspectionView =
  | {
      status: "ready";
      context: InspectionContext;
      items: InspectionItem[];
      weights: RobotWeight[];
      weightLimitLbs: number;
    }
  | { status: "setup_required"; context: InspectionContext; message: string };

// ---------------------------------------------------------------------------
// Derived metrics (pure, unit-tested).
// ---------------------------------------------------------------------------

export type InspectionProgress = {
  total: number;
  pass: number;
  fail: number;
  pending: number;
  na: number;
  percent: number; // resolved (pass+na) / total
  ready: boolean; // nothing pending, nothing failing
};

export function inspectionProgress(items: InspectionItem[]): InspectionProgress {
  const total = items.length;
  const count = (status: InspectionStatus) => items.filter((item) => item.status === status).length;
  const pass = count("pass");
  const fail = count("fail");
  const pending = count("pending");
  const na = count("na");
  return {
    total,
    pass,
    fail,
    pending,
    na,
    percent: total ? Math.round(((pass + na) / total) * 100) : 0,
    ready: total > 0 && fail === 0 && pending === 0,
  };
}

export type WeightStatus = {
  latest: RobotWeight | null;
  marginLbs: number | null; // limit - latest (negative = overweight)
  over: boolean;
};

export function weightStatus(weights: RobotWeight[], limitLbs: number): WeightStatus {
  const sorted = [...weights].sort((a, b) => (a.weighedAt < b.weighedAt ? 1 : -1));
  const latest = sorted[0] ?? null;
  if (!latest) return { latest: null, marginLbs: null, over: false };
  const margin = Math.round((limitLbs - latest.totalLbs) * 100) / 100;
  return { latest, marginLbs: margin, over: margin < 0 };
}

/** Group items by category preserving template order, customs last per category. */
export function groupByCategory(items: InspectionItem[]): Array<{ category: string; items: InspectionItem[] }> {
  const order = new Map(INSPECTION_TEMPLATE.map((entry, index) => [entry.category, index]));
  const byCategory = new Map<string, InspectionItem[]>();
  for (const item of items) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }
  return [...byCategory.entries()]
    .map(([category, list]) => ({
      category,
      items: [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.requirement.localeCompare(b.requirement)),
    }))
    .sort((a, b) => (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99) || a.category.localeCompare(b.category));
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

function robotLabel(value: unknown) {
  return optionalText(value, 40) ?? "competition";
}

export type InspectionAction =
  | { action: "seed_checklist"; orgId: string; robotLabel: string }
  | { action: "add_item"; orgId: string; robotLabel: string; category: string; requirement: string }
  | { action: "set_status"; orgId: string; id: string; status: InspectionStatus; note: string | null }
  | { action: "delete_item"; orgId: string; id: string }
  | { action: "reset_checklist"; orgId: string; robotLabel: string }
  | { action: "log_weight"; orgId: string; robotLabel: string; totalLbs: number; config: string; note: string }
  | { action: "delete_weight"; orgId: string; id: string }
  | { action: "set_weight_limit"; orgId: string; weightLimitLbs: number };

export function parseInspectionAction(input: unknown): InspectionAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid inspection action");
  const body = input as Record<string, unknown>;
  const action = requiredText(body.action, "Action", 40);
  const orgId = uuid(body.orgId, "Organization");

  switch (action) {
    case "seed_checklist":
    case "reset_checklist":
      return { action, orgId, robotLabel: robotLabel(body.robotLabel) };

    case "add_item":
      return {
        action,
        orgId,
        robotLabel: robotLabel(body.robotLabel),
        category: requiredText(body.category, "Category", 80),
        requirement: requiredText(body.requirement, "Requirement", 300),
      };

    case "set_status": {
      const status = requiredText(body.status, "Status", 20) as InspectionStatus;
      if (!INSPECTION_STATUSES.includes(status)) throw new Error("Invalid inspection status");
      return { action, orgId, id: uuid(body.id, "Item"), status, note: optionalText(body.note, 500) };
    }

    case "delete_item":
      return { action, orgId, id: uuid(body.id, "Item") };

    case "log_weight": {
      const totalLbs = Number(body.totalLbs);
      if (!Number.isFinite(totalLbs) || totalLbs <= 0 || totalLbs >= 1000) {
        throw new Error("Weight must be between 0 and 1000 lbs");
      }
      return {
        action,
        orgId,
        robotLabel: robotLabel(body.robotLabel),
        totalLbs: Math.round(totalLbs * 100) / 100,
        config: optionalText(body.config, 120) ?? "",
        note: optionalText(body.note, 300) ?? "",
      };
    }

    case "delete_weight":
      return { action, orgId, id: uuid(body.id, "Weight entry") };

    case "set_weight_limit": {
      const limit = Number(body.weightLimitLbs);
      if (!Number.isFinite(limit) || limit <= 0 || limit >= 1000) {
        throw new Error("Weight limit must be between 0 and 1000 lbs");
      }
      return { action, orgId, weightLimitLbs: Math.round(limit * 100) / 100 };
    }

    default:
      throw new Error("Unsupported inspection action");
  }
}
