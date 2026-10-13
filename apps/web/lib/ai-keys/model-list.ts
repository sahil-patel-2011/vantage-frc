/**
 * Model names typed as a comma-separated line ("claude-haiku-5-5, gpt-4.1-mini").
 * Matching is against the catalog the routing prefs actually store.
 */

export type ListedModel = {
  id: string;
  modelId: string;
  label: string;
  /** An effort variant. Automode does not pick these; Fixed model does. */
  fixedOnly?: boolean;
};

export function modelTokens(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Store and show a typed list with one space after each comma, and no empty slots. */
export function normalizeModelText(text: string): string {
  return modelTokens(text).join(", ");
}

export function matchModelList(
  text: string,
  options: readonly ListedModel[],
  mode: "fixed" | "automode",
): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const token of modelTokens(text)) {
    const key = token.toLowerCase();
    const hit =
      options.find((option) => option.id.toLowerCase() === key) ??
      options.find((option) => option.label.toLowerCase() === key) ??
      options.find((option) => option.modelId.toLowerCase() === key);
    if (!hit) {
      unknown.push(token);
      continue;
    }
    if (mode === "automode" && hit.fixedOnly) {
      unknown.push(`${token} (only available when you choose one model)`);
      continue;
    }
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    ids.push(hit.id);
  }
  return mode === "fixed" ? { ids: ids.slice(0, 1), unknown } : { ids, unknown };
}

/** The names to put back in the field: the provider's model id, in the saved order. */
export function formatModelList(ids: readonly string[], options: readonly ListedModel[]): string {
  return ids
    .map((id) => options.find((option) => option.id === id)?.modelId ?? "")
    .filter(Boolean)
    .join(", ");
}
