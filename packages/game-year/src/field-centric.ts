import type { GameField } from "./types";

/**
 * Year-agnostic collection fields. These describe where the scout sat, not
 * invented scoring metrics.
 */
export const FIELD_CENTRIC_FIELDS: GameField[] = [
  {
    key: "alliance_station",
    label: "Alliance station",
    type: "select",
    options: ["red1", "red2", "red3", "blue1", "blue2", "blue3"],
    helpText: "Field-centric seat for this entry.",
  },
];

export function withFieldCentric(fields: GameField[]): GameField[] {
  const keys = new Set(fields.map((field) => field.key));
  const extra = FIELD_CENTRIC_FIELDS.filter((field) => !keys.has(field.key));
  return [...extra, ...fields];
}
