/**
 * The five places: Home, Competition, Team, Build, Business. The same five, in the same order,
 * are the desktop sidebar and the phone's bottom bar, and nothing else is a top-level
 * destination. Every tool lives in one of them (or is found with search). Ask AI is not a place:
 * it is the search field's "Ask AI" row. The AI and Media hubs keep their URLs; Media counts
 * as Business (it is Business › Outreach), AI as no place.
 */
import { findNavMatch, type ProductNavIcon } from "./product-nav";
import { hubIdForPath, type ClientHubId } from "./hub-access-filter";

export type PlaceId = "home" | "competition" | "team" | "build" | "business";

export type Place = {
  id: PlaceId;
  href: string;
  label: string;
  /** The bottom bar's name, where the full one does not fit a fifth of a phone. */
  shortLabel: string;
  icon: ProductNavIcon;
};

/**
 * Warmed once the shell is idle, after the page the person is on. Hover still warms anything
 * else. Workspace stays out: it is a heavy page and not a place.
 */
export const IDLE_PREFETCH_HREFS: readonly string[] = [
  "/dashboard",
  "/competition",
  "/team",
  "/build",
  "/business",
  "/schedule",
  "/match-sim",
  "/strategy",
  "/ranking-projection",
  "/scouting",
];

export const PLACES: readonly Place[] = [
  { id: "home", href: "/dashboard", label: "Home", shortLabel: "Home", icon: "home" },
  { id: "competition", href: "/competition", label: "Competition", shortLabel: "Compete", icon: "swords" },
  { id: "team", href: "/team", label: "Team", shortLabel: "Team", icon: "users" },
  { id: "build", href: "/build", label: "Build", shortLabel: "Build", icon: "cube" },
  { id: "business", href: "/business", label: "Business", shortLabel: "Business", icon: "clipboard" },
];

const BY_GROUP_LABEL = new Map<string, PlaceId>(PLACES.map((place) => [place.label, place.id]));

/** Hubs that are not a place of their own: Media is Business › Outreach; AI is search's row. */
const PLACE_FOR_HUB: Record<ClientHubId, PlaceId | null> = {
  competition: "competition",
  team: "team",
  build: "build",
  business: "business",
  media: "business",
  ai: null,
};

/**
 * The place a page belongs to, or null (Settings, Account, Help, Ask AI, Admin). Home and a
 * hub's own URL are themselves; then the page's nav match decides, so legacy tool URLs
 * (/scouting, /hours) and Business tools that live under /team/… (/team/grants) light up the
 * place that lists them; then the hub the access rules file the path under.
 */
export function placeForPath(pathname: string): PlaceId | null {
  const path = pathname.split("?")[0] || "/";
  if (path === "/dashboard" || path.startsWith("/dashboard/")) return "home";
  const root = PLACES.find((place) => place.href === path);
  if (root) return root.id;
  const match = findNavMatch(path);
  const matched = match ? BY_GROUP_LABEL.get(match.group.label) : undefined;
  if (matched) return matched;
  const hub = hubIdForPath(path);
  return hub ? PLACE_FOR_HUB[hub] : null;
}

/** The places this person may open, in order. */
export function visiblePlaces(allowed: (href: string) => boolean): Place[] {
  return PLACES.filter((place) => allowed(place.href));
}
