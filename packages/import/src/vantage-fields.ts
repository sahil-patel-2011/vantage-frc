/**
 * The Vantage scouting field-type names an importer is allowed to emit.
 *
 * This mirrors `FieldType` from `@vantage/scouting`. It is duplicated here on
 * purpose: `@vantage/import` stays a dependency-free pure-parser package, so a
 * connector can be unit tested without pulling the scouting runtime in. The
 * mirror is not allowed to drift — `apps/web/lib/migrate/compute-migrate.ts`
 * holds a compile-time assertion that every name here is a real `FieldType`,
 * so adding a bogus name fails `tsc`, not production.
 */
export const VANTAGE_FIELD_TYPES = [
  "number",
  "boolean",
  "text",
  "select",
  "dropdown",
  "multiple_choice",
  "short_answer",
  "long_text",
  "drivetrain_type",
  "robot_image",
  "counter",
  "multi_counter",
  "timer",
  "rating",
  "multi_select",
  "slider",
  "section_header",
  "field_position",
] as const;

export type VantageFieldType = (typeof VANTAGE_FIELD_TYPES)[number];

/** Turn a foreign field id into a key the Vantage form builder accepts. */
export function toFieldKey(raw: string, fallback: string): string {
  const key = raw
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return key || fallback;
}
