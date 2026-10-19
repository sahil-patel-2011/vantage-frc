// Request-body parsing for /api/manufacturing/steps: strings trimmed and capped,
// ids checked, nothing passed through that the database would have to refuse.

import { cleanDrawingUrl, type ShopStepAction } from "./steps";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function requiredId(value: unknown, what: string): string {
  const id = uuidOrNull(value);
  if (!id) throw new Error(`${what} is missing.`);
  return id;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, max) : null;
}

function longText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function title(value: unknown): string {
  const cleaned = text(value, 120);
  if (!cleaned) throw new Error("Name the step, like “Mill pockets”.");
  return cleaned;
}

/** Turns a POST body into one shop-step change, or throws the sentence to show. */
export function parseShopStepAction(body: Record<string, unknown>): ShopStepAction {
  switch (body.action) {
    case "add-step":
      return { action: "add-step", partId: requiredId(body.partId, "Part"), title: title(body.title), machine: text(body.machine, 60), notes: longText(body.notes, 2000) };
    case "use-template":
      return { action: "use-template", partId: requiredId(body.partId, "Part") };
    case "edit-step":
      return { action: "edit-step", stepId: requiredId(body.stepId, "Step"), title: title(body.title), machine: text(body.machine, 60), notes: longText(body.notes, 2000) };
    case "move-step":
      if (body.direction !== "up" && body.direction !== "down") throw new Error("Move a step up or down.");
      return { action: "move-step", stepId: requiredId(body.stepId, "Step"), direction: body.direction };
    case "delete-step":
      return { action: "delete-step", stepId: requiredId(body.stepId, "Step") };
    case "start-step":
      return { action: "start-step", stepId: requiredId(body.stepId, "Step"), workedBy: uuidOrNull(body.workedBy) };
    case "finish-step":
      return { action: "finish-step", stepId: requiredId(body.stepId, "Step"), workedBy: uuidOrNull(body.workedBy) };
    case "reopen-step":
      return { action: "reopen-step", stepId: requiredId(body.stepId, "Step") };
    case "set-drawing":
      return { action: "set-drawing", partId: requiredId(body.partId, "Part"), drawingUrl: cleanDrawingUrl(body.drawingUrl) };
    default:
      throw new Error("Unknown action.");
  }
}
