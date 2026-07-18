import type { FieldDefinition, SchemaDefinition } from "./index";

const IDENTITY_KEYS = new Set([
  "scout","scoutname","scout_name","scouter","scoutername","scouter_name",
  "scoutid","scout_id","enteredby","entered_by","recordedby","recorded_by",
  "submittedby","submitted_by","yourname","your_name",
]);
const IDENTITY_LABELS = new Set([
  "scout","scoutname","scouter","scoutername","yourname","enteredby","recordedby","submittedby",
]);
function compact(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}
export type ScoutIdentity = { userId: string; displayName: string; email?: string | null };
export function isScoutIdentityField(field: Pick<FieldDefinition, "key" | "label">): boolean {
  const key = compact(field.key);
  if (IDENTITY_KEYS.has(key)) return true;
  if (key === "name" && /scout|scouter/i.test(field.label ?? "")) return true;
  const label = compact(field.label ?? "");
  if (!label) return false;
  if (IDENTITY_LABELS.has(label)) return true;
  if (label.includes("scoutname") || label.includes("scoutername")) return true;
  if ((label.includes("scout") || label.includes("scouter")) && label.includes("name")) return true;
  return false;
}
export function stripScoutIdentityFields(definition: SchemaDefinition) {
  const removed: FieldDefinition[] = [];
  const fields: FieldDefinition[] = [];
  for (const field of definition.fields) {
    if (isScoutIdentityField(field)) removed.push(field);
    else fields.push(field);
  }
  return { definition: { ...definition, fields }, removed };
}
export function lockScoutPayload(payload: Record<string, unknown>) {
  const removedKeys: string[] = [];
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (isScoutIdentityField({ key, label: key })) { removedKeys.push(key); continue; }
    next[key] = value;
  }
  return { payload: next, removedKeys };
}
export function assertSchemaIdentityLock(definition: SchemaDefinition): string | null {
  const { removed } = stripScoutIdentityFields(definition);
  if (!removed.length) return null;
  return `Scout identity fields are locked to membership userId — remove free-text name fields: ${removed.map((f) => f.label || f.key).join(", ")}`;
}
export function bindScoutIdentity(input: { userId: string; displayName?: string | null; email?: string | null }): ScoutIdentity {
  return {
    userId: input.userId,
    displayName: input.displayName?.trim() || input.email?.trim() || "Team scout",
    email: input.email ?? null,
  };
}
