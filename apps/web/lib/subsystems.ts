// Robot subsystem spec sheet. A quick-reference of each mechanism's key numbers
// (motor, count, gear reduction, wheel size) — the stuff teams constantly re-derive
// from CAD. For the drivetrain it computes theoretical free speed (ft/s), a
// calculation teams do on every design iteration. Distinct from CAD (models) and
// the wiring map (electrical).

export type MotorDef = { value: string; label: string; freeRpm: number };

// Free speed (RPM) at 12V, no load — manufacturer/community-cited figures.
export const MOTORS: MotorDef[] = [
  { value: "neo", label: "NEO", freeRpm: 5676 },
  { value: "neo550", label: "NEO 550", freeRpm: 11000 },
  { value: "neovortex", label: "NEO Vortex", freeRpm: 6784 },
  { value: "falcon500", label: "Falcon 500", freeRpm: 6380 },
  { value: "krakenx60", label: "Kraken X60", freeRpm: 6000 },
  { value: "krakenx44", label: "Kraken X44", freeRpm: 7530 },
  { value: "cim", label: "CIM", freeRpm: 5330 },
  { value: "minicim", label: "MiniCIM", freeRpm: 5840 },
  { value: "bag", label: "BAG", freeRpm: 13180 },
  { value: "775pro", label: "775pro", freeRpm: 18730 },
];

const MOTOR_MAP = new Map(MOTORS.map((m) => [m.value, m]));
export function motorLabel(value: string) {
  return MOTOR_MAP.get(value)?.label ?? value;
}
export function motorFreeRpm(value: string): number | null {
  return MOTOR_MAP.get(value)?.freeRpm ?? null;
}

export const SUBSYSTEM_CATEGORIES = [
  "drivetrain",
  "intake",
  "shooter",
  "arm",
  "elevator",
  "climber",
  "turret",
  "indexer",
  "other",
] as const;
export type SubsystemCategory = (typeof SUBSYSTEM_CATEGORIES)[number];

/**
 * Theoretical free speed in ft/s: wheel RPM (motor free RPM / reduction) times
 * wheel circumference, converted to feet per second. Returns null if any input
 * is missing or non-positive.
 */
export function computeFreeSpeedFps(
  motorFreeRpm: number | null,
  gearReduction: number | null,
  wheelDiameterIn: number | null,
): number | null {
  if (!motorFreeRpm || !gearReduction || !wheelDiameterIn) return null;
  if (motorFreeRpm <= 0 || gearReduction <= 0 || wheelDiameterIn <= 0) return null;
  const wheelRpm = motorFreeRpm / gearReduction;
  const circumferenceIn = Math.PI * wheelDiameterIn;
  const inchesPerMinute = wheelRpm * circumferenceIn;
  const feetPerSecond = inchesPerMinute / 12 / 60;
  return Math.round(feetPerSecond * 100) / 100;
}

export type SubsystemInput = {
  name: string;
  category: SubsystemCategory;
  motorType: string;
  motorCount: number | null;
  gearReduction: number | null;
  wheelDiameterIn: number | null;
  notes: string;
};

function optPositive(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${field} must be greater than zero`);
  return parsed;
}
function optCount(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${field} must be a non-negative whole number`);
  return parsed;
}

export function validateSubsystem(raw: Record<string, unknown>): { ok: true; value: SubsystemInput } | { ok: false; error: string } {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, error: "Subsystem name is required" };
  const category = String(raw.category ?? "other");
  if (!SUBSYSTEM_CATEGORIES.includes(category as SubsystemCategory)) return { ok: false, error: "Invalid category" };
  let motorCount: number | null;
  let gearReduction: number | null;
  let wheelDiameterIn: number | null;
  try {
    motorCount = optCount(raw.motorCount, "Motor count");
    gearReduction = optPositive(raw.gearReduction, "Gear reduction");
    wheelDiameterIn = optPositive(raw.wheelDiameterIn, "Wheel diameter");
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid number" };
  }
  return {
    ok: true,
    value: {
      name,
      category: category as SubsystemCategory,
      motorType: typeof raw.motorType === "string" ? raw.motorType.trim() : "",
      motorCount,
      gearReduction,
      wheelDiameterIn,
      notes: typeof raw.notes === "string" ? raw.notes.trim() : "",
    },
  };
}

// ---- request validation --------------------------------------------------

export type SubsystemAction =
  | ({ action: "create_subsystem"; orgId: string; seasonYear: number } & SubsystemInput)
  | { action: "update_subsystem"; orgId: string; id: string; patch: SubsystemInput }
  | { action: "delete_subsystem"; orgId: string; id: string };

function reqStr(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

export function parseSubsystemAction(raw: unknown): SubsystemAction {
  if (!raw || typeof raw !== "object") throw new Error("Invalid request body");
  const body = raw as Record<string, unknown>;
  const action = reqStr(body.action, "action");
  const orgId = reqStr(body.orgId, "orgId");

  switch (action) {
    case "create_subsystem": {
      const validated = validateSubsystem(body);
      if (!validated.ok) throw new Error(validated.error);
      const seasonYear = Number(body.seasonYear);
      if (!Number.isInteger(seasonYear)) throw new Error("seasonYear is required");
      return { action, orgId, seasonYear, ...validated.value };
    }
    case "update_subsystem": {
      const validated = validateSubsystem(body);
      if (!validated.ok) throw new Error(validated.error);
      return { action, orgId, id: reqStr(body.id, "id"), patch: validated.value };
    }
    case "delete_subsystem":
      return { action, orgId, id: reqStr(body.id, "id") };
    default:
      throw new Error("Unsupported subsystem action");
  }
}
