import type { SchemaDefinition } from "@vantage/scouting";

/** Counted quantities use tap controls; measured times/rates and totals use typed values. */
export function isTapCounterField(field: Pick<SchemaDefinition["fields"][number], "type" | "key" | "label" | "config">): boolean {
  return field.type === "number" && !/time|sec|\(s\)|weight|rate|avg|average|percent|%|speed|total/i.test(`${field.key} ${field.label}`);
}
