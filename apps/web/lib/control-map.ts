// Driver control map. The drive team's button-map reference: what every
// controller input does, per controller (driver / operator). Teams keep this as
// a cheat sheet taped to the driver station; here it's structured and shareable,
// and it stays in sync as bindings change through the season.

export const CONTROLLERS = ["driver", "operator", "other"] as const;
export type Controller = (typeof CONTROLLERS)[number];

export const CONTROLLER_LABEL: Record<Controller, string> = {
  driver: "Driver",
  operator: "Operator",
  other: "Other",
};

export const CONTROL_MODES = ["teleop", "test", "both"] as const;
export type ControlMode = (typeof CONTROL_MODES)[number];

/** Common gamepad inputs, offered as quick-fill suggestions. */
export const COMMON_INPUTS = [
  "A button",
  "B button",
  "X button",
  "Y button",
  "Left bumper",
  "Right bumper",
  "Left trigger",
  "Right trigger",
  "Left stick X",
  "Left stick Y",
  "Right stick X",
  "Right stick Y",
  "Left stick press",
  "Right stick press",
  "D-pad up",
  "D-pad down",
  "D-pad left",
  "D-pad right",
  "Start",
  "Back",
];

// `command` is the action the input triggers (WPILib term). It is deliberately
// NOT named `action` so it never collides with the request `action` discriminant.
export type BindingInput = { controller: Controller; inputLabel: string; command: string; mode: ControlMode; notes: string };

export function validateBinding(raw: Record<string, unknown>): { ok: true; value: BindingInput } | { ok: false; error: string } {
  const controller = String(raw.controller ?? "driver");
  if (!CONTROLLERS.includes(controller as Controller)) return { ok: false, error: "Invalid controller" };
  const inputLabel = typeof raw.inputLabel === "string" ? raw.inputLabel.trim() : "";
  if (!inputLabel) return { ok: false, error: "Input (button/axis) is required" };
  const command = typeof raw.command === "string" ? raw.command.trim() : "";
  if (!command) return { ok: false, error: "Action is required" };
  const mode = String(raw.mode ?? "teleop");
  if (!CONTROL_MODES.includes(mode as ControlMode)) return { ok: false, error: "Invalid mode" };
  return {
    ok: true,
    value: { controller: controller as Controller, inputLabel, command, mode: mode as ControlMode, notes: typeof raw.notes === "string" ? raw.notes.trim() : "" },
  };
}

export function summarizeBindings(bindings: { controller: Controller }[]) {
  const byController = { driver: 0, operator: 0, other: 0 } as Record<Controller, number>;
  for (const b of bindings) byController[b.controller] += 1;
  return { total: bindings.length, byController };
}

// ---- request validation --------------------------------------------------

export type ControlMapAction =
  | ({ action: "create_binding"; orgId: string; seasonYear: number } & BindingInput)
  | { action: "update_binding"; orgId: string; id: string; patch: BindingInput }
  | { action: "delete_binding"; orgId: string; id: string };

function reqStr(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

export function parseControlMapAction(raw: unknown): ControlMapAction {
  if (!raw || typeof raw !== "object") throw new Error("Invalid request body");
  const body = raw as Record<string, unknown>;
  const action = reqStr(body.action, "action");
  const orgId = reqStr(body.orgId, "orgId");

  switch (action) {
    case "create_binding": {
      const validated = validateBinding(body);
      if (!validated.ok) throw new Error(validated.error);
      const seasonYear = Number(body.seasonYear);
      if (!Number.isInteger(seasonYear)) throw new Error("seasonYear is required");
      return { action: "create_binding", orgId, seasonYear, ...validated.value };
    }
    case "update_binding": {
      const validated = validateBinding(body);
      if (!validated.ok) throw new Error(validated.error);
      return { action: "update_binding", orgId, id: reqStr(body.id, "id"), patch: validated.value };
    }
    case "delete_binding":
      return { action: "delete_binding", orgId, id: reqStr(body.id, "id") };
    default:
      throw new Error("Unsupported control map action");
  }
}
