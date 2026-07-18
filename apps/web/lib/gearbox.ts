// Gearbox ratio calculator. A robot gearbox is a chain of gear/sprocket/pulley
// stages; the compound reduction is the product of each stage's driven/driving
// tooth ratio. Teams compute this constantly while designing drivetrains and
// mechanisms. This stores a gearbox as its list of stages and computes the
// compound ratio and output speed. Distinct from the subsystem spec sheet, which
// stores a single already-computed reduction.

export type Stage = { driving: number; driven: number };

export function validateStages(raw: unknown): { ok: true; value: Stage[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "Add at least one gear stage" };
  if (raw.length > 8) return { ok: false, error: "A gearbox can have at most 8 stages" };
  const stages: Stage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { ok: false, error: "Invalid stage" };
    const driving = Number((item as Record<string, unknown>).driving);
    const driven = Number((item as Record<string, unknown>).driven);
    if (!Number.isFinite(driving) || driving <= 0 || !Number.isFinite(driven) || driven <= 0) {
      return { ok: false, error: "Each stage needs positive driving and driven tooth counts" };
    }
    stages.push({ driving, driven });
  }
  return { ok: true, value: stages };
}

/** Compound reduction = product of driven/driving across stages (>1 = reduction). */
export function compoundReduction(stages: Stage[]): number {
  const ratio = stages.reduce((acc, s) => acc * (s.driven / s.driving), 1);
  return Math.round(ratio * 1000) / 1000;
}

export function outputRpm(inputRpm: number, reduction: number): number | null {
  if (!Number.isFinite(inputRpm) || inputRpm <= 0 || !Number.isFinite(reduction) || reduction <= 0) return null;
  return Math.round((inputRpm / reduction) * 10) / 10;
}

/** Torque multiplies by the reduction (ignoring efficiency losses). */
export function torqueMultiplier(reduction: number): number {
  return Math.round(reduction * 1000) / 1000;
}

export function describeStages(stages: Stage[]): string {
  return stages.map((s) => `${s.driving}:${s.driven}`).join(" → ");
}

export type GearboxInput = { name: string; subsystem: string; stages: Stage[]; motorFreeRpm: number | null; notes: string };

export function validateGearbox(raw: Record<string, unknown>): { ok: true; value: GearboxInput } | { ok: false; error: string } {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, error: "Gearbox name is required" };
  const stagesResult = validateStages(raw.stages);
  if (!stagesResult.ok) return { ok: false, error: stagesResult.error };
  let motorFreeRpm: number | null = null;
  if (raw.motorFreeRpm !== undefined && raw.motorFreeRpm !== null && raw.motorFreeRpm !== "") {
    motorFreeRpm = Number(raw.motorFreeRpm);
    if (!Number.isFinite(motorFreeRpm) || motorFreeRpm < 0) return { ok: false, error: "Motor free RPM must be zero or greater" };
  }
  return {
    ok: true,
    value: {
      name,
      subsystem: typeof raw.subsystem === "string" ? raw.subsystem.trim() : "",
      stages: stagesResult.value,
      motorFreeRpm,
      notes: typeof raw.notes === "string" ? raw.notes.trim() : "",
    },
  };
}

// ---- request validation --------------------------------------------------

export type GearboxAction =
  | ({ action: "save_gearbox"; orgId: string; seasonYear: number } & GearboxInput)
  | { action: "delete_gearbox"; orgId: string; id: string };

function reqStr(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

export function parseGearboxAction(raw: unknown): GearboxAction {
  if (!raw || typeof raw !== "object") throw new Error("Invalid request body");
  const body = raw as Record<string, unknown>;
  const action = reqStr(body.action, "action");
  const orgId = reqStr(body.orgId, "orgId");

  switch (action) {
    case "save_gearbox": {
      const validated = validateGearbox(body);
      if (!validated.ok) throw new Error(validated.error);
      const seasonYear = Number(body.seasonYear);
      if (!Number.isInteger(seasonYear)) throw new Error("seasonYear is required");
      return { action: "save_gearbox", orgId, seasonYear, ...validated.value };
    }
    case "delete_gearbox":
      return { action: "delete_gearbox", orgId, id: reqStr(body.id, "id") };
    default:
      throw new Error("Unsupported gearbox action");
  }
}
