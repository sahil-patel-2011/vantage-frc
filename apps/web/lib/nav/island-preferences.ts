import { ISLAND_TAB_CATALOG, PRIMARY_TABS, type IslandTabDefinition } from "./product-nav";

export const ISLAND_SLOT_COUNT = 4;

export function isValidIslandSelection(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length !== ISLAND_SLOT_COUNT) return false;
  if (!value.every((href): href is string => typeof href === "string")) return false;
  if (new Set(value).size !== ISLAND_SLOT_COUNT) return false;
  const allowed = new Set(ISLAND_TAB_CATALOG.map((item) => item.href));
  return value.every((href) => allowed.has(href));
}

export function resolveIslandTabs(value: unknown): IslandTabDefinition[] {
  if (!isValidIslandSelection(value)) return PRIMARY_TABS;
  const byHref = new Map(ISLAND_TAB_CATALOG.map((item) => [item.href, item]));
  return value.map((href) => byHref.get(href)!).filter(Boolean);
}

export function defaultIslandHrefs(): string[] {
  return PRIMARY_TABS.map((item) => item.href);
}

/** "Home, Matches, Scout, and Stats" — the labels people actually see. */
export function joinIslandLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

export function defaultIslandLabelList(): string {
  return joinIslandLabels(PRIMARY_TABS.map((item) => item.label));
}

export function islandCatalogLabelList(): string {
  return joinIslandLabels(ISLAND_TAB_CATALOG.map((item) => item.label));
}

/** True when this member is still on the stock four (Home, Matches, Scout, Stats). */
export function isDefaultIslandSelection(value: unknown): boolean {
  const defaults = defaultIslandHrefs();
  if (!isValidIslandSelection(value)) return true;
  return value.every((href, index) => href === defaults[index]);
}

export type IslandDraftResult = {
  draft: string[];
  /** Set when the tap was refused, so the editor can say why. */
  error: string | null;
};

/**
 * Tap-to-add / tap-to-remove used by both island editors (the long-press sheet in
 * the shell and the Account → Appearance copy). Order of taps is slot order.
 */
export function toggleIslandDraft(draft: readonly string[], href: string): IslandDraftResult {
  if (draft.includes(href)) {
    return { draft: draft.filter((item) => item !== href), error: null };
  }
  if (draft.length >= ISLAND_SLOT_COUNT) {
    return {
      draft: [...draft],
      error: `The island holds ${ISLAND_SLOT_COUNT} apps. Remove one first.`,
    };
  }
  const allowed = new Set(ISLAND_TAB_CATALOG.map((item) => item.href));
  if (!allowed.has(href)) return { draft: [...draft], error: "That app is not on the island catalog." };
  return { draft: [...draft, href], error: null };
}
