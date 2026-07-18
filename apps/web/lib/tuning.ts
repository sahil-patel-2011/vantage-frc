// Tuning / calibration constants log. The tuned values that are painful to lose
// and easy to forget where they live: swerve module absolute-encoder offsets,
// PID/feedforward gains, sensor zero offsets, vision transforms, soft limits.
// Recording them here means a reflash or a lost laptop doesn't cost you a day of
// re-tuning. Stored as text so any form (radians, gains, arrays) is preserved.

export const TUNING_CATEGORIES = ["encoder_offset", "pid", "feedforward", "sensor", "vision", "limit", "gearing", "other"] as const;
export type TuningCategory = (typeof TUNING_CATEGORIES)[number];

export const TUNING_CATEGORY_LABEL: Record<TuningCategory, string> = {
  encoder_offset: "Encoder offset",
  pid: "PID gains",
  feedforward: "Feedforward",
  sensor: "Sensor offset",
  vision: "Vision transform",
  limit: "Soft limit",
  gearing: "Gearing / conversion",
  other: "Other",
};

export type ConstantInput = { subsystem: string; name: string; value: string; unit: string; category: TuningCategory; notes: string };

export function validateConstant(raw: Record<string, unknown>): { ok: true; value: ConstantInput } | { ok: false; error: string } {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, error: "Constant name is required" };
  const value = typeof raw.value === "string" ? raw.value.trim() : "";
  if (!value) return { ok: false, error: "Value is required" };
  const category = String(raw.category ?? "other");
  if (!TUNING_CATEGORIES.includes(category as TuningCategory)) return { ok: false, error: "Invalid category" };
  return {
    ok: true,
    value: {
      subsystem: typeof raw.subsystem === "string" ? raw.subsystem.trim() : "",
      name,
      value,
      unit: typeof raw.unit === "string" ? raw.unit.trim() : "",
      category: category as TuningCategory,
      notes: typeof raw.notes === "string" ? raw.notes.trim() : "",
    },
  };
}

export function summarizeTuning(constants: { subsystem: string; category: TuningCategory }[]) {
  const byCategory = Object.fromEntries(TUNING_CATEGORIES.map((c) => [c, 0])) as Record<TuningCategory, number>;
  const subsystems = new Set<string>();
  for (const c of constants) {
    byCategory[c.category] += 1;
    subsystems.add(c.subsystem || "General");
  }
  return { total: constants.length, subsystems: subsystems.size, byCategory };
}

// ---- request validation --------------------------------------------------

export type TuningAction =
  | ({ action: "save_constant"; orgId: string; seasonYear: number } & ConstantInput)
  | { action: "delete_constant"; orgId: string; id: string };

function reqStr(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

export function parseTuningAction(raw: unknown): TuningAction {
  if (!raw || typeof raw !== "object") throw new Error("Invalid request body");
  const body = raw as Record<string, unknown>;
  const action = reqStr(body.action, "action");
  const orgId = reqStr(body.orgId, "orgId");

  switch (action) {
    case "save_constant": {
      const validated = validateConstant(body);
      if (!validated.ok) throw new Error(validated.error);
      const seasonYear = Number(body.seasonYear);
      if (!Number.isInteger(seasonYear)) throw new Error("seasonYear is required");
      return { action: "save_constant", orgId, seasonYear, ...validated.value };
    }
    case "delete_constant":
      return { action: "delete_constant", orgId, id: reqStr(body.id, "id") };
    default:
      throw new Error("Unsupported tuning action");
  }
}
