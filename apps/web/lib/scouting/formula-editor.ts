import { isFormulaDraftExpression, isUnseenFormulaAnswer, type FormulaExpression, type FieldDefinition } from "@vantage/scouting";

export type SavedFormula = { id: string; name: string; expression: FormulaExpression; revision: string; updatedAt: string };
export const SCORING_ROLE_NAMES = {
  "Total points": ["total", "total points", "points", "match points", "value"],
  Auto: ["auto", "auto points", "autonomous", "auto_points"],
  Teleop: ["teleop", "teleop points", "tele-op", "teleop_points"],
  Endgame: ["endgame", "endgame points", "end game", "climb", "endgame_points"],
} as const;
export const normalizeFormulaName = (name: string) => name.trim().toLowerCase().replace(/[\s_-]+/g, " ");
export function formulaForRole(rows: SavedFormula[], role: keyof typeof SCORING_ROLE_NAMES): SavedFormula | undefined {
  const byName = new Map(rows.map(row => [normalizeFormulaName(row.name), row]));
  for (const alias of SCORING_ROLE_NAMES[role]) { const row = byName.get(normalizeFormulaName(alias)); if (row) return row; }
}
export const NUMERIC_FORMULA_TYPES = new Set(["number", "counter", "rating", "slider", "timer"]);
export const CHOICE_FORMULA_TYPES = new Set(["select", "dropdown", "multiple_choice", "drivetrain_type", "boolean"]);
export function formulaOptions(field: FieldDefinition): string[] { return field.type === "boolean" ? ["true", "false"] : field.options ?? []; }
export function defaultFormulaTerm(fields: FieldDefinition[]): FormulaExpression {
  const number = fields.find(field => NUMERIC_FORMULA_TYPES.has(field.type));
  if (number) return { op: "field", field: number.key };
  const choice = fields.find(field => CHOICE_FORMULA_TYPES.has(field.type));
  return choice ? { op: "lookup", field: choice.key, values: {} } : { op: "constant", value: NaN };
}

export type FormulaEditorDraft = { name: string; expression: FormulaExpression; baseRevision: string | null; schemaId: string; savedAt: string };
export const formulaDraftKey = (userId: string, orgId: string, name: string) => `vantage-scoring-draft:${encodeURIComponent(userId)}:${orgId}:${encodeURIComponent(name)}`;
export function latestFormulaDraft(storage: Pick<Storage, "length" | "key" | "getItem">, prefix: string): { key: string; raw: string; draft: FormulaEditorDraft } | null {
  const drafts: Array<{ key: string; raw: string; draft: FormulaEditorDraft }> = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key || !(key === prefix || key.startsWith(`${prefix}:`))) continue;
    const raw = storage.getItem(key); const draft = readFormulaDraft(raw);
    if (raw && draft) drafts.push({ key, raw, draft });
  }
  return drafts.sort((a,b) => Date.parse(b.draft.savedAt) - Date.parse(a.draft.savedAt))[0] ?? null;
}

/** JSON null in a numeric slot represents an intentionally unfilled draft input. */
export function readFormulaDraft(raw: string | null): FormulaEditorDraft | null {
  if (!raw || raw.length > 100_000) return null;
  try {
    const draft = JSON.parse(raw) as FormulaEditorDraft;
    if (!draft || typeof draft.name !== "string" || !draft.name.trim() || draft.name.length > 100 || typeof draft.schemaId !== "string"
      || !(draft.baseRevision === null || typeof draft.baseRevision === "string") || !Number.isFinite(Date.parse(draft.savedAt))) return null;
    let nodes = 0;
    const restore = (node: FormulaExpression, depth = 0): FormulaExpression => {
      if (++nodes > 256 || depth > 12 || !node || typeof node !== "object") throw new Error("Invalid draft");
      if (node.op === "constant") return { ...node, value: node.value === null ? NaN : node.value };
      if (node.op === "lookup" && node.values && typeof node.values === "object" && !Array.isArray(node.values)) return { ...node, values: Object.fromEntries(Object.entries(node.values).map(([key, value]) => [key, value === null ? NaN : value])) };
      return "args" in node && Array.isArray(node.args) ? { ...node, args: node.args.map(child => restore(child, depth + 1)) } : node;
    };
    const expression = restore(draft.expression);
    return isFormulaDraftExpression(expression) ? { ...draft, expression } : null;
  } catch { return null; }
}

/** New saves must use the selected published questions and their answer types. */
export function formulaInputError(expression: FormulaExpression, fields: FieldDefinition[]): string | null {
  const byKey = new Map(fields.map(field => [field.key, field]));
  function check(node: FormulaExpression): string | null {
    if (node.op === "field" || node.op === "lookup") {
      const field = byKey.get(node.field);
      if (!field) return `Question “${node.field}” is not in this published match form.`;
      if (node.op === "field" && !NUMERIC_FORMULA_TYPES.has(field.type)) return `“${field.label}” needs points per answer, rather than a numeric weight.`;
      if (node.op === "lookup" && (!CHOICE_FORMULA_TYPES.has(field.type) || Object.keys(node.values).some(key => !formulaOptions(field).includes(key)))) return `Review the answer mappings for “${field.label}”.`;
      if (node.op === "lookup" && Object.keys(node.values).some(isUnseenFormulaAnswer)) return `Unseen answers in “${field.label}” must remain unknown, rather than mapped to points.`;
      return null;
    }
    for (const child of "args" in node ? node.args : []) { const error = check(child); if (error) return error; }
    return null;
  }
  return check(expression);
}
