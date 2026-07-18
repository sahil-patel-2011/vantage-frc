// Robot weight budget. FRC robots have a hard weight limit (125 lb without
// battery and bumpers). Going over means failing inspection; getting close
// means no margin for mid-season additions. This sums logged component weights
// against a configurable limit and tracks the remaining margin per subsystem.

export const DEFAULT_WEIGHT_LIMIT_LBS = 125;

export type ComponentInput = { name: string; subsystem: string; weightLbs: number; quantity: number; notes: string };

export function validateComponent(raw: Record<string, unknown>): { ok: true; value: ComponentInput } | { ok: false; error: string } {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, error: "Component name is required" };
  const weightLbs = Number(raw.weightLbs);
  if (!Number.isFinite(weightLbs) || weightLbs < 0) return { ok: false, error: "Weight must be zero or greater" };
  let quantity = 1;
  if (raw.quantity !== undefined && raw.quantity !== null && raw.quantity !== "") {
    quantity = Number(raw.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) return { ok: false, error: "Quantity must be a positive whole number" };
  }
  return {
    ok: true,
    value: {
      name,
      subsystem: typeof raw.subsystem === "string" ? raw.subsystem.trim() : "",
      weightLbs: Math.round(weightLbs * 100) / 100,
      quantity,
      notes: typeof raw.notes === "string" ? raw.notes.trim() : "",
    },
  };
}

export type WeightComponent = { subsystem: string; weightLbs: number; quantity: number };

export function summarizeWeight(components: WeightComponent[], limitLbs = DEFAULT_WEIGHT_LIMIT_LBS) {
  const bySubsystem = new Map<string, number>();
  let total = 0;
  for (const c of components) {
    const line = c.weightLbs * c.quantity;
    total += line;
    const key = c.subsystem || "Unassigned";
    bySubsystem.set(key, (bySubsystem.get(key) ?? 0) + line);
  }
  total = round2(total);
  return {
    count: components.length,
    totalLbs: total,
    limitLbs,
    remainingLbs: round2(limitLbs - total),
    overLimit: total > limitLbs,
    percentUsed: limitLbs > 0 ? Math.round((total / limitLbs) * 100) : 0,
    bySubsystem: [...bySubsystem.entries()]
      .map(([subsystem, lbs]) => ({ subsystem, lbs: round2(lbs) }))
      .sort((a, b) => b.lbs - a.lbs),
  };
}

// ---- request validation --------------------------------------------------

export type WeightAction =
  | ({ action: "create_component"; orgId: string; seasonYear: number } & ComponentInput)
  | { action: "update_component"; orgId: string; id: string; patch: ComponentInput }
  | { action: "delete_component"; orgId: string; id: string }
  | { action: "set_limit"; orgId: string; seasonYear: number; limitLbs: number };

function reqStr(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

export function parseWeightAction(raw: unknown): WeightAction {
  if (!raw || typeof raw !== "object") throw new Error("Invalid request body");
  const body = raw as Record<string, unknown>;
  const action = reqStr(body.action, "action");
  const orgId = reqStr(body.orgId, "orgId");

  switch (action) {
    case "create_component": {
      const validated = validateComponent(body);
      if (!validated.ok) throw new Error(validated.error);
      const seasonYear = Number(body.seasonYear);
      if (!Number.isInteger(seasonYear)) throw new Error("seasonYear is required");
      return { action: "create_component", orgId, seasonYear, ...validated.value };
    }
    case "update_component": {
      const validated = validateComponent(body);
      if (!validated.ok) throw new Error(validated.error);
      return { action: "update_component", orgId, id: reqStr(body.id, "id"), patch: validated.value };
    }
    case "delete_component":
      return { action: "delete_component", orgId, id: reqStr(body.id, "id") };
    case "set_limit": {
      const seasonYear = Number(body.seasonYear);
      if (!Number.isInteger(seasonYear)) throw new Error("seasonYear is required");
      const limitLbs = Number(body.limitLbs);
      if (!Number.isFinite(limitLbs) || limitLbs <= 0) throw new Error("Weight limit must be greater than zero");
      return { action: "set_limit", orgId, seasonYear, limitLbs: Math.round(limitLbs * 100) / 100 };
    }
    default:
      throw new Error("Unsupported weight action");
  }
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
