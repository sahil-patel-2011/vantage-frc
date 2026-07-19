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
