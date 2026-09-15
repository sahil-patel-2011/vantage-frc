/** Who reads this answer after save. Empty means the question is not worth asking. */

export const SCOUT_FIELD_USES = ["pick_list", "alliance", "pit", "repair"] as const;

export type ScoutFieldUse = (typeof SCOUT_FIELD_USES)[number];

export const SCOUT_FIELD_USE_LABELS: Record<ScoutFieldUse, string> = {
  pick_list: "Pick list",
  alliance: "Alliance",
  pit: "Pit",
  repair: "Repair",
};

export function isScoutFieldUse(value: unknown): value is ScoutFieldUse {
  return typeof value === "string" && (SCOUT_FIELD_USES as readonly string[]).includes(value);
}

export function normalizeScoutFieldUses(value: unknown): ScoutFieldUse[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<ScoutFieldUse>();
  for (const item of value) {
    if (isScoutFieldUse(item)) seen.add(item);
  }
  return SCOUT_FIELD_USES.filter((use) => seen.has(use));
}

/** Help paragraph plus "Helps: Pick list · Alliance" so scouts know why they are tapping. */
export function formatScoutFieldHelp(input: {
  helpText?: string | null;
  helps?: readonly ScoutFieldUse[] | null;
}): string | undefined {
  const help = input.helpText?.trim() ?? "";
  const uses = (input.helps ?? [])
    .map((use) => SCOUT_FIELD_USE_LABELS[use])
    .filter(Boolean);
  const useLine = uses.length ? `Helps: ${uses.join(" · ")}` : "";
  if (help && useLine) return `${help} ${useLine}`;
  return help || useLine || undefined;
}
