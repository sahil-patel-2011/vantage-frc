/**
 * The five places: Home, Competition, Team, Build, Business. The same five, in the same order,
 * are the desktop sidebar and the phone's bottom bar, and nothing else is a top-level
 * destination. Every tool lives in one of them (or is found with search). Ask AI is not a place:
 * it is the search field's "Ask AI" row. The AI and Media hubs keep their URLs; Media counts
 * as Business (it is Business › Outreach), AI as no place.
 */
import { findNavMatch, type ProductNavIcon } from "./product-nav";

export type PlaceId = "home" | "competition" | "team" | "build" | "business";

export type Place = {
  id: PlaceId;
  href: string;
  label: string;
  /** The bottom bar's name, where the full one does not fit a fifth of a phone. */
  shortLabel: string;
  icon: ProductNavIcon;
};

export const PLACES: readonly Place[] = [
  { id: "home", href: "/dashboard", label: "Home", shortLabel: "Home", icon: "home" },
  { id: "competition", href: "/competition", label: "Competition", shortLabel: "Compete", icon: "swords" },
  { id: "team", href: "/team", label: "Team", shortLabel: "Team", icon: "users" },
  { id: "build", href: "/build", label: "Build", shortLabel: "Build", icon: "cube" },
  { id: "business", href: "/business", label: "Business", shortLabel: "Business", icon: "clipboard" },
];

const BY_GROUP_LABEL = new Map<string, PlaceId>(PLACES.map((place) => [place.label, place.id]));

/** Paths that belong to a place without being one of its hub tabs. */
const PREFIXES: ReadonlyArray<readonly [string, PlaceId]> = [
  ["/dashboard", "home"],
  ["/competition", "competition"],
  ["/team", "team"],
  ["/build", "build"],
  ["/business", "business"],
  ["/media", "business"],
];

/**
 * The place a page belongs to, or null (Settings, Account, Help, Ask AI, Admin). A hub's own URL
 * wins; otherwise the page's nav match decides, so legacy tool URLs (/scouting, /hours) still
 * light up their place.
 */
export function placeForPath(pathname: string): PlaceId | null {
  const path = pathname.split("?")[0] || "/";
  for (const [prefix, id] of PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return id;
  }
  const match = findNavMatch(path);
  return match ? (BY_GROUP_LABEL.get(match.group.label) ?? null) : null;
}

/** The places this person may open, in order. */
export function visiblePlaces(allowed: (href: string) => boolean): Place[] {
  return PLACES.filter((place) => allowed(place.href));
}
