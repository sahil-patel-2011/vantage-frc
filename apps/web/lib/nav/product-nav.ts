/**
 * Product navigation — single source of truth for the app-shell drawer,
 * command palette, and breadcrumb labels.
 *
 * Pillars: Competition · Team · Logistics · Business · Build · AI
 * (+ Home entry + Settings). See docs/FEATURE_MAP.md.
 */

import { PRODUCT_HUBS } from "./hubs";

export type NavItemState = "setup" | "planned";

export type ProductNavItem = {
  href: string;
  label: string;
  icon: ProductNavIcon;
  state?: NavItemState;
};

export type ProductNavGroup = {
  label: string;
  tone: string;
  toneBg: string;
  icon: ProductNavIcon;
  items: ProductNavItem[];
};

export type ProductNavIcon =
  | "menu"
  | "search"
  | "bell"
  | "x"
  | "home"
  | "swords"
  | "scout"
  | "stats"
  | "chevron"
  | "chat"
  | "target"
  | "calendar"
  | "clipboard"
  | "users"
  | "bolt"
  | "cube"
  | "code"
  | "display"
  | "gear"
  | "grid"
  | "pin"
  | "back";

const TONE = { tone: "#1f4fd6", toneBg: "#e8eefc" } as const;

/** Routes that never append ?orgId= (account / platform chrome). */
export const ORG_EXEMPT_HREFS = new Set([
  "/dashboard",
  "/account",
  "/security",
  "/admin",
  "/notifications",
  "/help",
  "/support",
  "/signin",
  "/sign-in",
]);

/**
 * Consolidated IA — features grouped by job, not every page as a peer.
 * Duplicate destinations (e.g. /intel under Scouting, /calendar under Kickoff) are removed.
 */
export const PRODUCT_NAV_GROUPS: ProductNavGroup[] = [
  {
    label: "Home",
    ...TONE,
    icon: "home",
    items: [
      { href: "/dashboard", label: "Home", icon: "home" },
      { href: "/start", label: "Your path", icon: "pin" },
      { href: "/workspace", label: "Workspace", icon: "grid" },
      { href: "/announcements", label: "Announcements", icon: "bell" },
    ],
  },
  {
    label: "Competition",
    ...TONE,
    icon: "swords",
    items: [
      { href: "/competition", label: "Competition hub", icon: "swords" },
      { href: "/competition?tab=command", label: "Command", icon: "target" },
      { href: "/competition?tab=my-day", label: "My Day", icon: "calendar" },
      { href: "/competition?tab=strategy", label: "Strategy", icon: "stats" },
      { href: "/competition?tab=scouting", label: "Scouting", icon: "scout" },
      { href: "/scouting/forms", label: "Form builder", icon: "clipboard" },
      { href: "/scouting/lineup", label: "Lineup & Coverage", icon: "target" },
      { href: "/offline-shell", label: "Offline Shell", icon: "pin" },
      { href: "/intel", label: "Matches & Teams", icon: "swords" },
      { href: "/schedule", label: "Match Schedule", icon: "calendar" },
      { href: "/competition?tab=pick-clock", label: "Pick clock", icon: "target" },
      { href: "/competition?tab=chemistry", label: "Chemistry", icon: "users" },
      { href: "/dossier", label: "Team Dossier", icon: "clipboard" },
      { href: "/rankings", label: "Rankings", icon: "stats" },
      { href: "/video", label: "Video Review", icon: "display" },
      { href: "/pit", label: "Pit Command", icon: "cube" },
      { href: "/incidents", label: "Incidents", icon: "gear" },
      { href: "/match-checklist", label: "Match Checklist", icon: "clipboard" },
      { href: "/briefing", label: "Event Briefing", icon: "clipboard" },
      { href: "/match-debrief", label: "Match Debrief", icon: "chat" },
      { href: "/inspection", label: "Inspection", icon: "target" },
    ],
  },
  {
    label: "Team",
    ...TONE,
    icon: "users",
    items: [
      { href: "/team", label: "Team hub", icon: "users" },
      { href: "/team?tab=calendar", label: "Calendar", icon: "calendar" },
      { href: "/calendar", label: "Season Calendar", icon: "calendar" },
      { href: "/team?tab=practice", label: "Practice", icon: "target" },
      { href: "/shifts", label: "Shifts", icon: "users" },
      { href: "/team?tab=attendance", label: "Attendance", icon: "users" },
      { href: "/hours", label: "Build Hours", icon: "stats" },
      { href: "/team?tab=todos", label: "Todos", icon: "clipboard" },
      { href: "/team?tab=messages", label: "Messages", icon: "chat" },
      { href: "/goals", label: "Goals", icon: "target" },
      { href: "/risks", label: "Risk Register", icon: "bolt" },
      { href: "/roles", label: "Roles", icon: "users" },
      { href: "/team/getting-started", label: "Team setup", icon: "pin" },
      { href: "/team?tab=knowledge", label: "Knowledge", icon: "clipboard" },
      { href: "/team/alumni", label: "Alumni", icon: "users" },
      { href: "/team/admin", label: "Admin", icon: "gear" },
      { href: "/team/discord", label: "Discord", icon: "chat" },
      { href: "/team/data", label: "Data analytics", icon: "stats" },
      { href: "/training", label: "Training Matrix", icon: "users", state: "planned" },
      { href: "/leadership", label: "Leadership Continuity", icon: "users", state: "planned" },
      { href: "/retro", label: "Team Retrospective", icon: "chat", state: "planned" },
      { href: "/season-rollover", label: "Season Rollover", icon: "calendar", state: "planned" },
      { href: "/mock-judging", label: "Mock Judging", icon: "chat", state: "planned" },
    ],
  },
  {
    label: "Logistics",
    ...TONE,
    icon: "pin",
    items: [
      { href: "/logistics", label: "Event Logistics", icon: "pin" },
      { href: "/packing", label: "Packing List", icon: "grid" },
      { href: "/duties", label: "Duty Roster", icon: "users" },
      { href: "/visit-invites", label: "Visit Invites", icon: "users" },
    ],
  },
  {
    label: "Business",
    ...TONE,
    icon: "clipboard",
    items: [
      { href: "/business", label: "Business Hub", icon: "clipboard" },
      { href: "/business?tab=orders", label: "Orders", icon: "clipboard" },
      { href: "/costs", label: "Season Costs", icon: "stats" },
      { href: "/business?tab=budget", label: "Finance", icon: "stats" },
      { href: "/team/sponsors", label: "Sponsors", icon: "users" },
      { href: "/business?tab=sponsorship", label: "Sponsorship", icon: "clipboard" },
      { href: "/business?tab=grants", label: "Grants", icon: "clipboard" },
      { href: "/team/awards", label: "Awards", icon: "target" },
      { href: "/fundraisers", label: "Fundraisers", icon: "bolt" },
      { href: "/impact", label: "Community Impact", icon: "target" },
      { href: "/recognition", label: "Recognition", icon: "users" },
      { href: "/exports", label: "Exports", icon: "clipboard" },
    ],
  },
  {
    label: "Build",
    ...TONE,
    icon: "cube",
    items: [
      { href: "/build", label: "Build hub", icon: "cube" },
      { href: "/build?tab=kickoff", label: "Kickoff", icon: "bolt" },
      { href: "/build?tab=cad", label: "CAD", icon: "cube", state: "setup" },
      { href: "/build?tab=code", label: "Code", icon: "code" },
      { href: "/build?tab=batteries", label: "Batteries", icon: "bolt" },
      { href: "/robot", label: "Robot Blueprint", icon: "gear" },
      { href: "/subsystems", label: "Subsystems", icon: "grid" },
      { href: "/build?tab=fmea", label: "FMEA", icon: "gear" },
      { href: "/display", label: "Displays", icon: "display" },
      { href: "/inventory", label: "Inventory & BOM", icon: "grid" },
      { href: "/vendors", label: "Vendors & Suppliers", icon: "clipboard" },
      { href: "/control-map", label: "Control Map", icon: "target" },
      { href: "/software-versions", label: "Software Versions", icon: "code" },
      { href: "/decisions", label: "Decisions", icon: "clipboard" },
      { href: "/parts-relay", label: "FRC Parts Relay", icon: "bolt", state: "planned" },
    ],
  },
  {
    label: "AI",
    ...TONE,
    icon: "bolt",
    items: [
      { href: "/ai", label: "AI hub", icon: "bolt" },
      { href: "/ai?tab=chat", label: "Chat", icon: "chat" },
      { href: "/ai?tab=budgets", label: "Budgets", icon: "stats" },
      { href: "/ai?tab=governance", label: "Governance", icon: "gear" },
      { href: "/ai?tab=finance", label: "Finance toggle", icon: "stats" },
      { href: "/writer", label: "Award Writer", icon: "chat" },
      { href: "/team/usage", label: "AI usage", icon: "stats" },
    ],
  },
  {
    label: "Settings",
    ...TONE,
    icon: "gear",
    items: [
      { href: "/account", label: "Account", icon: "users" },
      { href: "/whats-new", label: "What’s new", icon: "bell" },
      { href: "/support", label: "Help & Support", icon: "chat" },
      { href: "/notifications", label: "Notifications", icon: "bell" },
      { href: "/security", label: "Security", icon: "gear" },
      { href: "/team/security", label: "Team security", icon: "gear" },
      { href: "/team/background", label: "Team background", icon: "users" },
      { href: "/ai?tab=budgets", label: "API budgets", icon: "stats" },
      { href: "/team/admin", label: "API keys & admin", icon: "gear" },
    ],
  },
];

/** Bottom island — glanceable; full IA lives in the drawer / More sheet. */
export const PRIMARY_TABS: Array<{ href: string; label: string; icon: ProductNavIcon }> = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/competition", label: "Compete", icon: "swords" },
  { href: "/team", label: "Team", icon: "users" },
  { href: "/business", label: "Business", icon: "clipboard" },
];

/** Quick destinations in the mobile More sheet (pillars, not a laundry list). */
export const MORE_SHEET_LINKS: Array<{ href: string; label: string; icon: ProductNavIcon }> = [
  { href: "/competition?tab=my-day", label: "My Day", icon: "calendar" },
  { href: "/team?tab=messages", label: "Messages", icon: "chat" },
  { href: "/team?tab=knowledge", label: "Knowledge", icon: "clipboard" },
  { href: "/logistics", label: "Logistics", icon: "pin" },
  { href: "/build", label: "Build", icon: "cube" },
  { href: "/ai", label: "AI", icon: "bolt" },
];

export function withOrgHref(href: string, orgId: string | null | undefined): string {
  if (!orgId) return href;
  const pathOnly = href.split("?")[0] ?? href;
  if (ORG_EXEMPT_HREFS.has(pathOnly) || pathOnly.startsWith("/admin")) return href;
  if (href.includes("orgId=")) return href;
  const join = href.includes("?") ? "&" : "?";
  return `${href}${join}orgId=${encodeURIComponent(orgId)}`;
}

/** Path portion of a nav href (hubs use ?tab=). */
function navPathOnly(href: string): string {
  return href.split("?")[0] || href;
}

/**
 * Longest matching nav href wins (so /team/security beats /team).
 * Also resolves Soft-UI hub legacy paths (/command → Competition / Command)
 * via PRODUCT_HUBS.legacyHref when the live href is a ?tab= destination.
 */
export function findNavMatch(
  pathname: string,
): { group: ProductNavGroup; item: ProductNavItem } | null {
  const path = pathname.split("?")[0] || "/";
  let best: { group: ProductNavGroup; item: ProductNavItem; score: number } | null = null;

  for (const group of PRODUCT_NAV_GROUPS) {
    for (const item of group.items) {
      if (item.state === "planned") continue;
      const hrefPath = navPathOnly(item.href);
      const exact = path === hrefPath;
      const nested = hrefPath !== "/" && path.startsWith(`${hrefPath}/`);
      if (!exact && !nested) continue;
      // Prefer specific Team routes over the hub root for nested paths.
      if (hrefPath === "/team" && nested) continue;
      if (exact && hrefPath === "/team" && group.label === "Settings") continue;
      // Prefer concrete hub tabs over bare hub roots when path is exactly the hub.
      const score =
        hrefPath.length +
        (exact ? 1_000 : 0) +
        (item.href.includes("?") ? -50 : 0) +
        (exact && !item.href.includes("?") ? 100 : 0);
      if (!best || score > best.score) best = { group, item, score };
    }
  }

  // Legacy Soft-UI redirects: /scouting, /kickoff, /messages, …
  if (!best || best.score < 1_000) {
    for (const hub of PRODUCT_HUBS) {
      for (const tab of hub.tabs) {
        if (!tab.legacyHref || path !== tab.legacyHref) continue;
        const group = PRODUCT_NAV_GROUPS.find((entry) => entry.label === hub.label);
        const item = group?.items.find(
          (entry) => entry.href === `${hub.href}?tab=${tab.id}` || navPathOnly(entry.href) === tab.legacyHref,
        );
        if (group && item) {
          return { group, item };
        }
        if (group) {
          return {
            group,
            item: {
              href: `${hub.href}?tab=${tab.id}`,
              label: tab.label,
              icon: group.icon,
            },
          };
        }
      }
    }
  }

  return best ? { group: best.group, item: best.item } : null;
}

export function breadcrumbForPath(pathname: string): string {
  const match = findNavMatch(pathname);
  if (!match) return "Vantage";
  return `${match.group.label} / ${match.item.label}`;
}

export function navTitleForPath(pathname: string): string | null {
  const match = findNavMatch(pathname);
  return match?.item.label ?? null;
}

export function flattenNavItems(includePlanned = false): ProductNavItem[] {
  return PRODUCT_NAV_GROUPS.flatMap((group) =>
    group.items.filter((item) => includePlanned || item.state !== "planned"),
  );
}
