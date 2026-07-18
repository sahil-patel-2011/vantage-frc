import type { FieldDefinition, SchemaDefinition } from "./index";

const IDENTITY_KEYS = new Set([
  "scout","scoutname","scout_name","scouter","scoutername","scouter_name",
  "scoutid","scout_id","enteredby","entered_by","recordedby","recorded_by",
  "submittedby","submitted_by","yourname","your_name","whoareyou","whoscouting",
  "scouterid","scouter_id","membername","member_name",
]);
const IDENTITY_LABELS = new Set([
  "scout","scoutname","scouter","scoutername","yourname","enteredby","recordedby","submittedby",
  "whoareyou","whoscouting","membername",
]);
function compact(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}
export type ScoutIdentity = { userId: string; displayName: string; email?: string | null };

/** Soft-UI copy shared by entry form + custom form builder. */
export const SCOUT_IDENTITY_LOCK_COPY = {
  eyebrow: "Scout identity locked",
  title: "Bound to membership userId",
  detail: "Free-text scout names are rejected. Entries always attribute to the signed-in member.",
} as const;

export function isScoutIdentityField(field: Pick<FieldDefinition, "key" | "label">): boolean {
  const key = compact(field.key);
  if (IDENTITY_KEYS.has(key)) return true;
  if (key === "name" && /scout|scouter|member/i.test(field.label ?? "")) return true;
  const label = compact(field.label ?? "");
  if (!label) return false;
  if (IDENTITY_LABELS.has(label)) return true;
  if (label.includes("scoutname") || label.includes("scoutername") || label.includes("membername")) return true;
  if ((label.includes("scout") || label.includes("scouter")) && label.includes("name")) return true;
  // Custom form builders often label "Who scouted?" / "Who entered this?"
  if (label.includes("whoscout") || label.includes("whoentered") || label.includes("whoareyou")) return true;
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
