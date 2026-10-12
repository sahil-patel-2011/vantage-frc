/**
 * "Your apps": one list of pinned places, shown in three spots.
 *
 *   - the phone's bottom bar (the first four),
 *   - the top row of the phone menu (all of them),
 *   - the Pinned group at the top of the desktop sidebar (all of them).
 *
 * One editor changes it, from any of those places. The full workspace list stays in the menu
 * and the sidebar whatever is pinned, so un-pinning something never hides it.
 *
 * Stored per person in profiles.pinned_apps (0729). Before 0729 the same idea was four
 * bottom-bar apps in profiles.island_tabs; `resolveStoredPins` reads both, so nobody loses a
 * saved bar. Pure and deterministic: the API route, the shell and the tests share it.
 */
import { mainMenuSections } from "./main-menu";
import {
  ISLAND_TAB_CATALOG,
  PRIMARY_TABS,
  PRODUCT_NAV_GROUPS,
  type IslandTabDefinition,
  type ProductNavIcon,
} from "./product-nav";
import { canonicalIslandHref, isValidIslandSelection, joinIslandLabels } from "./island-preferences";

export type PinDefinition = IslandTabDefinition;
export type PinGroup = { id: string; label: string; icon: ProductNavIcon; items: PinDefinition[] };

/** Dispatch on window to open the "Your apps" editor from anywhere (Account → Appearance). */
export const PINS_EDIT_EVENT = "vantage:pins-edit";
/** Dispatched on window after the editor saves; `detail.tabs` is the new list. */
export const PINS_CHANGED_EVENT = "vantage:pins-changed";

/** The most places a person can pin. Eight fills two rows of the phone menu. */
export const PIN_LIMIT = 8;
/** How many of the pins the phone's bottom bar shows (then More). */
export const BAR_SLOTS = 4;

/** Team-written lessons and PDFs. Shown as "Team resources"; the route stays /learn/team. */
export const TEAM_RESOURCES_PIN: PinDefinition = { href: "/learn/team", label: "Team resources", icon: "book" };

const EVERYDAY: PinDefinition[] = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/competition?tab=my-day", label: "My Day", icon: "calendar" },
  { href: "/team?tab=todos", label: "Tasks", icon: "assignment" },
  { href: "/hours-self-view", label: "My hours", icon: "activity" },
  { href: "/ai?tab=chat", label: "Ask AI", icon: "sparkles" },
];

/** Places that are not a workspace section but people still want one tap away. */
const EXTRAS: Record<string, PinDefinition[]> = {
  competition: [{ href: "/rankings", label: "Stats", icon: "stats" }],
  team: [
    TEAM_RESOURCES_PIN,
    { href: "/files", label: "Files", icon: "grid" },
    { href: "/logistics", label: "Logistics", icon: "pin" },
  ],
};

/**
 * The stock pins: the bottom bar's four (Home, Scout, Teams, Match plan), then the two the
 * phone menu's top row always had (My Day, Tasks), then Team resources.
 */
export const DEFAULT_PINS: readonly string[] = [
  ...PRIMARY_TABS.map((tab) => tab.href),
  "/competition?tab=my-day",
  "/team?tab=todos",
  TEAM_RESOURCES_PIN.href,
];

/** The bottom bar's stock four before 0729. A saved copy of exactly these means "default". */
const LEGACY_DEFAULT_BAR = PRIMARY_TABS.map((tab) => tab.href);

/** Short names fit a 78px bottom-bar slot; the bar's own names win where they differ. */
const BAR_NAMES = new Map(ISLAND_TAB_CATALOG.map((tab) => [tab.href, tab]));

/**
 * Every place that can be pinned, grouped the way the menu groups them. Each place appears
 * once. Not filtered for access: callers pass the same `allowed` check the menu uses.
 */
export function pinCatalog(allowed: (href: string) => boolean = () => true): PinGroup[] {
  const seen = new Set<string>();
  const take = (items: PinDefinition[]) =>
    items.flatMap((item) => {
      const named = BAR_NAMES.get(item.href) ?? item;
      if (seen.has(named.href) || !allowed(named.href)) return [];
      seen.add(named.href);
      return [{ href: named.href, label: named.label, icon: named.icon }];
    });
  const groups: PinGroup[] = [{ id: "everyday", label: "Everyday", icon: "home", items: take(EVERYDAY) }];
  for (const section of mainMenuSections(PRODUCT_NAV_GROUPS, () => true, true)) {
    groups.push({
      id: section.id,
      label: section.label,
      icon: section.icon,
      items: take([...section.items, ...(EXTRAS[section.id] ?? [])]),
    });
  }
  return groups.filter((group) => group.items.length > 0);
}

const CATALOG_BY_HREF: Map<string, PinDefinition> = new Map(
  [...pinCatalog().flatMap((group) => group.items), ...ISLAND_TAB_CATALOG].map((item) => [item.href, item] as const),
);

/** The place behind a pinned href, or null when it is not pinnable. */
export function pinDefinition(href: string): PinDefinition | null {
  return CATALOG_BY_HREF.get(canonicalIslandHref(href)) ?? null;
}

export function canonicalPinHref(href: string): string {
  return canonicalIslandHref(href);
}

/** 1–8 different pinnable places. */
export function isValidPinSelection(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > PIN_LIMIT) return false;
  if (!value.every((href): href is string => typeof href === "string")) return false;
  const canonical = value.map(canonicalPinHref);
  if (new Set(canonical).size !== canonical.length) return false;
  return canonical.every((href) => CATALOG_BY_HREF.has(href));
}

export function defaultPinHrefs(): string[] {
  return [...DEFAULT_PINS];
}

/** "Home, Scout, Teams, Match plan, My Day, Tasks, and Team resources" — for help and settings copy. */
export function defaultPinLabelList(): string {
  return joinIslandLabels(DEFAULT_PINS.map((href) => pinDefinition(href)?.label ?? href));
}

export function isDefaultPinSelection(value: readonly string[]): boolean {
  return value.length === DEFAULT_PINS.length && value.every((href, index) => canonicalPinHref(href) === DEFAULT_PINS[index]);
}

/**
 * What a person's pins are, from what is stored.
 *
 * `pinned` (profiles.pinned_apps) wins when it is a usable list. Otherwise the bottom bar saved
 * before 0729 (`islandTabs`) decides: a custom four stays exactly those four, and the empty
 * default or the old stock four get today's default pins.
 */
export function resolveStoredPins(pinned: unknown, islandTabs?: unknown): string[] {
  if (isValidPinSelection(pinned)) return pinned.map(canonicalPinHref);
  if (isValidIslandSelection(islandTabs)) {
    const legacy = islandTabs.map(canonicalIslandHref);
    const stock = legacy.every((href, index) => href === LEGACY_DEFAULT_BAR[index]);
    if (!stock) return legacy;
  }
  return defaultPinHrefs();
}

/** Definitions for a list of pinned hrefs, dropping anything unknown. */
export function resolvePins(hrefs: readonly string[]): PinDefinition[] {
  return hrefs.flatMap((href) => {
    const item = pinDefinition(href);
    return item ? [item] : [];
  });
}

/**
 * The copy kept in profiles.island_tabs for older code: the first four pins when they form a
 * valid bar, else the empty default.
 */
export function legacyBarFor(pins: readonly string[]): string[] {
  const firstFour = pins.slice(0, BAR_SLOTS).map(canonicalPinHref);
  return isValidIslandSelection(firstFour) ? firstFour : [];
}

/** Move one pin up or down by `delta` places (keyboard and button reordering). */
export function movePin(pins: readonly string[], href: string, delta: number): string[] {
  const from = pins.indexOf(href);
  if (from < 0) return [...pins];
  const to = Math.max(0, Math.min(pins.length - 1, from + delta));
  if (to === from) return [...pins];
  const next = [...pins];
  next.splice(from, 1);
  next.splice(to, 0, href);
  return next;
}

/** Move a pin to an exact index (drag and drop). */
export function placePin(pins: readonly string[], href: string, index: number): string[] {
  const from = pins.indexOf(href);
  if (from < 0) return [...pins];
  const next = pins.filter((item) => item !== href);
  next.splice(Math.max(0, Math.min(next.length, index)), 0, href);
  return next;
}

export type PinToggleResult = { pins: string[]; error: string | null };

/** Add a place at the end, or remove it. Refuses a ninth pin and the last one. */
export function togglePin(pins: readonly string[], href: string): PinToggleResult {
  const canonical = canonicalPinHref(href);
  if (pins.includes(canonical)) {
    if (pins.length <= 1) return { pins: [...pins], error: "Keep at least one app pinned." };
    return { pins: pins.filter((item) => item !== canonical), error: null };
  }
  if (!CATALOG_BY_HREF.has(canonical)) return { pins: [...pins], error: "That place can't be pinned." };
  if (pins.length >= PIN_LIMIT) {
    return { pins: [...pins], error: `You can pin up to ${PIN_LIMIT} apps. Remove one first.` };
  }
  return { pins: [...pins, canonical], error: null };
}
